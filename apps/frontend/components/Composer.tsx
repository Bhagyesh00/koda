'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Send, Square, Folder, FolderPlus,
  Zap, X, FileText, FolderOpen, Globe, Brain, BrainCircuit,
  AtSign, ChevronRight, Hand, Check, ShieldAlert, ClipboardPen, Loader2,
  Mic, MicOff, Paperclip,
} from 'lucide-react';
import { useChatStore } from '@/lib/store';
import { cn } from '@/lib/cn';
import { clearSessionMessages, compactSession, updateSessionModel, updateSessionSkill } from '@/lib/api';
import { loadWhisper, transcribeBlob, type ModelProgress } from '@/lib/whisper';
import { SkillOrb } from './SkillOrb';

// ── Constants ────────────────────────────────────────────────────────────────

const SLASH_COMMANDS = [
  { cmd: '/clear', desc: 'Clear chat history for this session' },
  { cmd: '/compact', desc: 'Compact history — keep last 20 messages' },
  { cmd: '/model', desc: 'Switch model, e.g. /model koda' },
] as const;

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  sessionId?: string | null;
  onSend: (text: string, opts?: { showThinking?: boolean }) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  cwd?: string;
  onSelectFolder: () => void;
  onCommandFeedback?: (msg: string, ok: boolean) => void;
}

interface AttachedItem {
  type: 'file' | 'folder' | 'web';
  path: string;
  displayName: string;
}

interface FileEntry {
  name: string;
  relPath: string;
  type: 'file' | 'directory';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function basename(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}

async function fetchFileContent(absPath: string): Promise<string> {
  const res = await fetch(`/api/fs/read?path=${encodeURIComponent(absPath)}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { content?: string };
  return data.content ?? '';
}

// ── Component ────────────────────────────────────────────────────────────────

export function Composer({
  sessionId, onSend, onStop, streaming, disabled,
  cwd, onSelectFolder, onCommandFeedback,
}: Props) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [text, setText] = useState('');
  const [activeSkill, setActiveSkill] = useState<string | null>(null);
  const [attached, setAttached] = useState<AttachedItem[]>([]);
  const [thinking, setThinking] = useState(true);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('ask');
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');

  // @ mention state
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [allFiles, setAllFiles] = useState<FileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);

  // Voice input runs entirely in the browser via @huggingface/transformers
  // (Whisper). The button cycles through these states; idle is the default.
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'loading' | 'recording' | 'transcribing'>('idle');
  const [voiceProgress, setVoiceProgress] = useState<ModelProgress | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordStreamRef = useRef<MediaStream | null>(null);

  const ref = useRef<HTMLTextAreaElement>(null);
  const mentionRef = useRef<HTMLDivElement>(null);
  const mode = useChatStore((s) => s.mode);
  const setMode = useChatStore((s) => s.setMode);
  const autoAccept = useChatStore((s) => s.autoAccept);
  const setAutoAccept = useChatStore((s) => s.setAutoAccept);

  // Sync permissionMode when store mode changes externally (e.g. plan approval → build)
  useEffect(() => {
    if (mode === 'build' && permissionMode === 'plan') {
      setPermissionMode('ask');
    } else if (mode === 'plan' && permissionMode !== 'plan') {
      setPermissionMode('plan');
    }
  }, [mode]);

  function handlePermissionChange(m: PermissionMode) {
    setPermissionMode(m);
    if (m === 'ask') { setAutoAccept(false); if (mode !== 'plan') setMode('build'); }
    else if (m === 'accept-edits') { setAutoAccept(true); if (mode !== 'plan') setMode('build'); }
    else if (m === 'plan') { setAutoAccept(false); setMode('plan'); }
    else if (m === 'bypass') { setAutoAccept(true); if (mode !== 'plan') setMode('build'); }
  }

  // ── Voice input (Whisper, browser-local) ─────────────────────────────────
  //
  // Replaces the Web Speech API path. Audio never leaves the browser; the
  // model downloads once (~75 MB) and is cached in IndexedDB by the
  // transformers.js runtime. Falls back from WebGPU to WASM automatically.
  //
  // State machine:  idle → loading → recording → transcribing → idle
  //
  // The mic button is the single user-facing entry point. Click while idle
  // starts recording (after lazy-loading the model on first use). Click while
  // recording stops and triggers transcription.

  function stopRecordStream() {
    recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    recordStreamRef.current = null;
  }

  async function toggleVoice() {
    if (typeof window === 'undefined') return;

    // Click while transcribing or loading is a no-op — the button is busy.
    if (voiceStatus === 'transcribing' || voiceStatus === 'loading') return;

    // Click while recording → stop. The recorder's onstop handler does the
    // actual transcription work below.
    if (voiceStatus === 'recording') {
      try {
        recorderRef.current?.stop();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onCommandFeedback?.(`Could not stop recording: ${msg}`, false);
        setVoiceStatus('idle');
        stopRecordStream();
      }
      return;
    }

    // Microphone permission first — surface a clean error if the user denies.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onCommandFeedback?.(`Microphone access denied: ${msg}`, false);
      return;
    }
    recordStreamRef.current = stream;

    // Lazy-load the model. Subsequent invocations return the cached pipeline.
    setVoiceStatus('loading');
    setVoiceProgress(null);
    try {
      await loadWhisper((p) => setVoiceProgress(p));
    } catch (err) {
      stopRecordStream();
      setVoiceStatus('idle');
      setVoiceProgress(null);
      const msg = err instanceof Error ? err.message : String(err);
      onCommandFeedback?.(`Failed to load voice model: ${msg}`, false);
      return;
    }
    setVoiceProgress(null);

    // Start MediaRecorder. Browsers pick a sensible default mime (webm/opus
    // on Chromium, mp4 on Safari) — both decode fine via AudioContext.
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch (err) {
      stopRecordStream();
      setVoiceStatus('idle');
      const msg = err instanceof Error ? err.message : String(err);
      onCommandFeedback?.(`Could not access microphone: ${msg}`, false);
      return;
    }

    audioChunksRef.current = [];
    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      stopRecordStream();
      const chunks = audioChunksRef.current;
      audioChunksRef.current = [];
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size === 0) {
        setVoiceStatus('idle');
        onCommandFeedback?.('No audio captured — try holding the mic button longer.', false);
        return;
      }
      setVoiceStatus('transcribing');
      try {
        const text = await transcribeBlob(blob);
        if (text) {
          setText((t) => (t ? `${t} ${text}` : text));
        } else {
          onCommandFeedback?.('No speech detected.', false);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onCommandFeedback?.(`Transcription failed: ${msg}`, false);
      } finally {
        setVoiceStatus('idle');
      }
    };
    recorder.onerror = (e: Event) => {
      stopRecordStream();
      setVoiceStatus('idle');
      const msg = (e as unknown as { error?: { message?: string } }).error?.message ?? 'recording error';
      onCommandFeedback?.(`Recording failed: ${msg}`, false);
    };

    try {
      recorder.start();
      recorderRef.current = recorder;
      setVoiceStatus('recording');
    } catch (err) {
      stopRecordStream();
      setVoiceStatus('idle');
      const msg = err instanceof Error ? err.message : String(err);
      onCommandFeedback?.(`Could not start recording: ${msg}`, false);
    }
  }

  // ── File upload ────────────────────────────────────────────────────────────

  async function handleFileUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const form = new FormData();
      for (const file of Array.from(files)) form.append('files', file);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const data = (await res.json()) as { files?: Array<{ originalName: string; path: string; mimeType: string }> };
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Upload failed');
      for (const f of data.files ?? []) {
        // Images: inline as markdown; others: reference as path
        if (f.mimeType.startsWith('image/')) {
          addAttachment({ type: 'file', path: f.path, displayName: f.originalName });
        } else {
          addAttachment({ type: 'file', path: f.path, displayName: f.originalName });
        }
      }
      onCommandFeedback?.(`${data.files?.length ?? 0} file(s) uploaded`, true);
    } catch (err) {
      onCommandFeedback?.(err instanceof Error ? err.message : 'Upload failed', false);
    } finally {
      setUploading(false);
    }
  }

  const filteredCmds = SLASH_COMMANDS.filter((c) =>
    c.cmd.startsWith(slashFilter || '/'),
  );

  // Auto-resize textarea
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = 'auto';
    ref.current.style.height = Math.min(ref.current.scrollHeight, 200) + 'px';
  }, [text]);

  // Close mention on outside click
  useEffect(() => {
    if (!mentionOpen) return;
    function handle(e: MouseEvent) {
      if (mentionRef.current && !mentionRef.current.contains(e.target as Node)) {
        closeMention();
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [mentionOpen]);

  // Load flat file list when @ is opened
  async function loadFiles() {
    if (!cwd || allFiles.length > 0) return; // cache
    setFilesLoading(true);
    try {
      const res = await fetch(`/api/fs/files?path=${encodeURIComponent(cwd)}&maxFiles=1000`);
      if (res.ok) {
        const data = (await res.json()) as { files: FileEntry[] };
        setAllFiles(data.files ?? []);
      }
    } catch { /* ignore */ }
    setFilesLoading(false);
  }

  function closeMention() {
    setMentionOpen(false);
    setMentionFilter('');
    setSelectedIdx(0);
  }

  function openMention() {
    setMentionOpen(true);
    setMentionFilter('');
    setSelectedIdx(0);
    void loadFiles();
  }

  function addAttachment(item: AttachedItem) {
    setAttached((prev) =>
      prev.some((a) => a.path === item.path && a.type === item.type) ? prev : [...prev, item],
    );
    closeMention();
    ref.current?.focus();
  }

  function removeAttachment(path: string) {
    setAttached((prev) => prev.filter((a) => a.path !== path));
  }

  // ── Slash commands ─────────────────────────────────────────────────────────

  async function handleSlashCommand(raw: string): Promise<boolean> {
    if (!sessionId) return false;
    const parts = raw.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    try {
      if (cmd === '/clear') {
        await clearSessionMessages(sessionId);
        onCommandFeedback?.('History cleared.', true);
        return true;
      }
      if (cmd === '/compact') {
        const count = await compactSession(sessionId);
        onCommandFeedback?.(`Compacted — ${count} messages kept.`, true);
        return true;
      }
      if (cmd === '/model') {
        const model = parts[1] ?? null;
        await updateSessionModel(sessionId, model);
        onCommandFeedback?.(model ? `Model set to ${model}.` : 'Model reset to default.', true);
        return true;
      }
    } catch (err) {
      onCommandFeedback?.(err instanceof Error ? err.message : 'Command failed.', false);
      return true;
    }
    return false;
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function submit() {
    const trimmed = text.trim();
    if ((!trimmed && attached.length === 0) || streaming || disabled) return;

    if (trimmed.startsWith('/') && attached.length === 0) {
      const handled = await handleSlashCommand(trimmed);
      if (handled) { setText(''); setSlashOpen(false); return; }
    }

    const parts: string[] = [];

    // Inject web search requests
    const webItems = attached.filter((a) => a.type === 'web');
    for (const w of webItems) {
      parts.push(`<web_search query="${w.path}" />`);
    }

    // Inject file/folder references
    const fileItems = attached.filter((a) => a.type === 'file');
    for (const f of fileItems) {
      try {
        const content = await fetchFileContent(f.path);
        parts.push(`<file path="${f.path}">\n\`\`\`\n${content}\n\`\`\`\n</file>`);
      } catch {
        parts.push(`<file path="${f.path}">[could not read file]</file>`);
      }
    }

    const folderItems = attached.filter((a) => a.type === 'folder');
    for (const d of folderItems) {
      parts.push(`<folder path="${d.path}" />`);
    }

    if (trimmed) parts.push(trimmed);

    onSend(parts.join('\n\n'), { showThinking: thinking });
    setText('');
    setAttached([]);
    setSlashOpen(false);
  }

  // ── Filtered file list for @ mention ─────────────────────────────────────

  const WEB_OPTION = { name: 'Web Search', relPath: '__web__', type: 'web' as const };
  const mentionResults = (() => {
    const q = mentionFilter.toLowerCase();
    const filtered = q
      ? allFiles.filter((f) => f.relPath.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
      : allFiles;
    const limited = filtered.slice(0, 30);
    // Always append web search option at the end
    return [...limited, WEB_OPTION] as Array<FileEntry | typeof WEB_OPTION>;
  })();

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="relative border-t border-border bg-bg/40 px-6 py-3">
      {streaming && (
        <div className="absolute left-0 right-0 top-0 h-[2px] overflow-hidden">
          <div className="koda-progress h-full w-full" />
        </div>
      )}

      <div className="mx-auto max-w-3xl">
        <div className="koda-glass flex flex-col rounded-2xl p-2 shadow-glow shadow-accent-glow/20">
          {/* Attached items */}
          {attached.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1 px-1">
              {attached.map((a) => (
                <span
                  key={`${a.type}-${a.path}`}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]',
                    a.type === 'file' && 'bg-sky-500/15 text-sky-400',
                    a.type === 'folder' && 'bg-violet-500/15 text-violet-400',
                    a.type === 'web' && 'bg-green-500/15 text-green-400',
                  )}
                >
                  {a.type === 'file' && <FileText size={9} />}
                  {a.type === 'folder' && <FolderOpen size={9} />}
                  {a.type === 'web' && <Globe size={9} />}
                  <span className="max-w-[160px] truncate font-mono">{a.displayName}</span>
                  <button
                    onClick={() => removeAttachment(a.path)}
                    className="ml-0.5 opacity-60 hover:opacity-100"
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Slash command palette */}
          {slashOpen && filteredCmds.length > 0 && (
            <div className="mb-1.5 rounded-lg border border-border bg-bg-panel/95 shadow-lg">
              {filteredCmds.map((c) => (
                <button
                  key={c.cmd}
                  onClick={() => { setText(c.cmd + ' '); setSlashOpen(false); ref.current?.focus(); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-bg-hover"
                >
                  <span className="font-mono text-accent">{c.cmd}</span>
                  <span className="text-fg-subtle">{c.desc}</span>
                </button>
              ))}
            </div>
          )}

          {/* @ mention — flat file picker */}
          {mentionOpen && (
            <div
              ref={mentionRef}
              className="mb-1.5 animate-fadeInUp rounded-xl border border-white/5"
              style={{
                background: 'rgba(17, 19, 23, 0.92)',
                backdropFilter: 'blur(16px)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.04)',
              }}
            >
              {/* Search input */}
              <div className="flex items-center gap-2 border-b border-white/[0.04] px-3 py-2">
                <AtSign size={13} className="shrink-0 text-accent" />
                <input
                  autoFocus
                  value={mentionFilter}
                  onChange={(e) => { setMentionFilter(e.target.value); setSelectedIdx(0); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { closeMention(); return; }
                    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, mentionResults.length - 1)); }
                    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const item = mentionResults[selectedIdx];
                      if (!item) return;
                      if (item.relPath === '__web__') {
                        // Use current filter as web search query
                        if (mentionFilter.trim()) {
                          addAttachment({ type: 'web', path: mentionFilter.trim(), displayName: mentionFilter.trim().slice(0, 40) });
                        }
                      } else {
                        const fullPath = cwd ? `${cwd}/${item.relPath}`.replace(/\\/g, '/').replace(/\/$/, '') : item.relPath;
                        addAttachment({
                          type: item.type === 'directory' ? 'folder' : 'file',
                          path: fullPath,
                          displayName: item.relPath,
                        });
                      }
                    }
                  }}
                  placeholder="Search files and folders..."
                  className="flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-subtle"
                />
                {filesLoading && <Loader2 size={12} className="shrink-0 animate-spin text-fg-subtle" />}
              </div>

              {/* File list */}
              <div className="max-h-[280px] overflow-y-auto py-1">
                {mentionResults.map((item, i) => {
                  const isSelected = i === selectedIdx;
                  const isWeb = item.relPath === '__web__';
                  const dirName = !isWeb && item.relPath.includes('/')
                    ? item.relPath.slice(0, item.relPath.lastIndexOf('/') + 1)
                    : undefined;

                  return (
                    <button
                      key={item.relPath}
                      onClick={() => {
                        if (isWeb) {
                          if (mentionFilter.trim()) {
                            addAttachment({ type: 'web', path: mentionFilter.trim(), displayName: mentionFilter.trim().slice(0, 40) });
                          }
                        } else {
                          const fullPath = cwd ? `${cwd}/${item.relPath}`.replace(/\\/g, '/').replace(/\/$/, '') : item.relPath;
                          addAttachment({
                            type: item.type === 'directory' ? 'folder' : 'file',
                            path: fullPath,
                            displayName: item.relPath,
                          });
                        }
                      }}
                      onMouseEnter={() => setSelectedIdx(i)}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
                        isSelected ? 'bg-accent/[0.08]' : 'hover:bg-white/[0.03]',
                        isWeb && 'border-t border-white/[0.04] mt-0.5',
                      )}
                    >
                      {isWeb ? (
                        <Globe size={13} className="shrink-0 text-green-400" />
                      ) : item.type === 'directory' ? (
                        <FolderOpen size={13} className="shrink-0 text-violet-400" />
                      ) : (
                        <FileText size={13} className="shrink-0 text-sky-400" />
                      )}
                      <span className={cn(
                        'flex-1 truncate text-[12px]',
                        isSelected ? 'text-fg' : 'text-fg-muted',
                      )}>
                        {isWeb
                          ? (mentionFilter.trim() ? `Search web: "${mentionFilter.trim()}"` : 'Web Search')
                          : item.name}
                      </span>
                      {dirName && !isWeb && (
                        <span className="shrink-0 truncate text-[10px] text-fg-subtle/60 font-mono max-w-[180px]">
                          {dirName}
                        </span>
                      )}
                    </button>
                  );
                })}
                {!filesLoading && allFiles.length === 0 && (
                  <div className="px-3 py-4 text-center text-[11px] text-fg-subtle">
                    {cwd ? 'No files found in workspace' : 'Open a folder first'}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Main input row */}
          <div className="flex items-end gap-1.5">
            <textarea
              ref={ref}
              value={text}
              onChange={(e) => {
                const v = e.target.value;
                setText(v);
                // Detect @ trigger
                if (v.endsWith('@') && !mentionOpen) {
                  openMention();
                }
                // Slash commands
                if (v.startsWith('/') && !v.includes(' ')) {
                  setSlashFilter(v);
                  setSlashOpen(true);
                } else {
                  setSlashOpen(false);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setSlashOpen(false); closeMention(); return; }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder={
                disabled
                  ? 'Select or create a session…'
                  : mode === 'plan'
                    ? 'Describe what you want planned… (@ to add context)'
                    : 'Ask Koda anything… (@ to add files, / for commands)'
              }
              rows={1}
              disabled={disabled}
              className="flex-1 resize-none bg-transparent px-2 py-2 text-[14px] text-fg outline-none placeholder:text-fg-subtle disabled:opacity-50"
            />

            {streaming ? (
              <button
                onClick={onStop}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-hover text-fg transition hover:bg-bg-subtle"
                aria-label="Stop"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                onClick={() => void submit()}
                disabled={(!text.trim() && attached.length === 0) || disabled}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white shadow-glow shadow-accent-glow transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                aria-label="Send"
              >
                <Send size={14} />
              </button>
            )}
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,.md,.pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.json,.csv,.ts,.js,.py,.rs,.go,.java,.c,.cpp,.h,.yml,.yaml,.toml,.xml,.html,.css,.mp4,.webm,.mov"
            className="hidden"
            onChange={(e) => { void handleFileUpload(e.target.files); e.target.value = ''; }}
          />

          {/* Toolbar row */}
          <div className="mt-1 flex items-center gap-1 border-t border-white/[0.04] px-1 pt-1.5">
            {/* @ mention button */}
            <ToolbarButton
              icon={<AtSign size={13} />}
              label="Add context"
              active={mentionOpen || attached.length > 0}
              activeColor="text-sky-400"
              onClick={openMention}
              disabled={streaming || disabled}
            />

            {/* File upload */}
            <ToolbarButton
              icon={uploading ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
              label="Upload file"
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming || disabled || uploading}
            />

            {/* Voice input — Whisper, runs entirely in the browser */}
            <ToolbarButton
              icon={
                voiceStatus === 'loading' || voiceStatus === 'transcribing'
                  ? <Loader2 size={13} className="animate-spin" />
                  : voiceStatus === 'recording'
                    ? <MicOff size={13} />
                    : <Mic size={13} />
              }
              label={
                voiceStatus === 'loading'
                  ? voiceProgress
                    ? `Loading model… ${voiceProgress.pct}%`
                    : 'Loading voice model…'
                  : voiceStatus === 'recording'
                    ? 'Stop recording'
                    : voiceStatus === 'transcribing'
                      ? 'Transcribing…'
                      : 'Voice input (local Whisper)'
              }
              active={voiceStatus !== 'idle'}
              activeColor={voiceStatus === 'recording' ? 'text-red-400' : 'text-accent'}
              onClick={toggleVoice}
              disabled={streaming || disabled || voiceStatus === 'loading' || voiceStatus === 'transcribing'}
            />

            {/* Thinking toggle */}
            <ToolbarButton
              icon={thinking ? <Brain size={13} /> : <BrainCircuit size={13} />}
              label={thinking ? 'Thinking' : 'No thinking'}
              active={!thinking}
              activeColor="text-accent-2"
              onClick={() => setThinking((v) => !v)}
              disabled={streaming || disabled}
            />

            <div className="mx-1 h-4 w-px bg-white/[0.06]" />

            {/* Skill orb */}
            <SkillOrb
              activeSkill={activeSkill}
              onSkillChange={async (slug) => {
                if (sessionId) {
                  try {
                    await updateSessionSkill(sessionId, slug);
                    setActiveSkill(slug);
                  } catch { /* ignore */ }
                }
              }}
            />

            <div className="flex-1" />

            {/* Permission mode (includes Plan/Build + approval level) */}
            <PermissionSelector
              mode={permissionMode}
              onChange={handlePermissionChange}
              disabled={streaming}
            />

            {/* Folder selector */}
            <button
              type="button"
              onClick={onSelectFolder}
              disabled={streaming}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition disabled:opacity-50',
                cwd
                  ? 'text-fg-subtle hover:bg-white/[0.04] hover:text-fg'
                  : 'bg-accent/10 text-accent hover:bg-accent/20',
              )}
              title={cwd ? `${cwd} — click to change` : 'Select working directory'}
            >
              {cwd ? <Folder size={11} /> : <FolderPlus size={11} />}
              <span className="max-w-[120px] truncate">
                {cwd ? basename(cwd) : 'Folder'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ToolbarButton({
  icon, label, active, activeColor, onClick, disabled,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  activeColor?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        'flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition disabled:opacity-40',
        active
          ? `bg-white/[0.06] ${activeColor ?? 'text-accent'}`
          : 'text-fg-subtle hover:bg-white/[0.04] hover:text-fg-muted',
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

// ── Permission Mode ──────────────────────────────────────────────────────────

type PermissionMode = 'ask' | 'accept-edits' | 'plan' | 'bypass';

const PERMISSION_OPTIONS: Array<{
  mode: PermissionMode;
  icon: React.ReactNode;
  label: string;
  desc: string;
  color: string;
}> = [
  { mode: 'ask', icon: <Hand size={14} />, label: 'Ask permissions', desc: 'Always ask before making changes', color: 'text-sky-400' },
  { mode: 'accept-edits', icon: <Check size={14} />, label: 'Accept edits', desc: 'Automatically accept all file edits', color: 'text-green-400' },
  { mode: 'plan', icon: <ClipboardPen size={14} />, label: 'Plan mode', desc: 'Create a plan before making changes', color: 'text-accent-2' },
  { mode: 'bypass', icon: <ShieldAlert size={14} />, label: 'Bypass permissions', desc: 'Accepts all permissions', color: 'text-yellow-400' },
];

function PermissionSelector({
  mode, onChange, disabled,
}: {
  mode: PermissionMode;
  onChange: (m: PermissionMode) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const current = PERMISSION_OPTIONS.find((o) => o.mode === mode) ?? PERMISSION_OPTIONS[0]!;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className={cn(
          'flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition disabled:opacity-40',
          `bg-white/[0.04] ${current.color}`,
          'hover:bg-white/[0.06]',
        )}
        title={current.desc}
      >
        {current.icon}
        <span className="hidden sm:inline">{current.label}</span>
      </button>

      {open && (
        <div
          className="absolute bottom-full right-0 mb-2 w-[260px] animate-fadeInUp rounded-xl border border-white/5 p-1.5"
          style={{
            background: 'rgba(17, 19, 23, 0.92)',
            backdropFilter: 'blur(16px)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.04)',
          }}
        >
          {PERMISSION_OPTIONS.map((opt) => {
            const isActive = mode === opt.mode;
            return (
              <button
                key={opt.mode}
                onClick={() => { onChange(opt.mode); setOpen(false); }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition',
                  isActive ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]',
                )}
              >
                <div className={cn('shrink-0', opt.color)}>{opt.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className={cn('text-[12px] font-medium', isActive ? 'text-fg' : 'text-fg-muted')}>
                    {opt.label}
                  </div>
                  <div className="text-[10px] text-fg-subtle">{opt.desc}</div>
                </div>
                {isActive && <Check size={12} className="shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

