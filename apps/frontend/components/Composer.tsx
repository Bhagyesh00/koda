'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Square, ClipboardList, Hammer, Folder, FolderPlus, Zap, Paperclip, X } from 'lucide-react';
import { useChatStore } from '@/lib/store';
import { cn } from '@/lib/cn';
import type { SessionMode } from '@koda/shared';
import { clearSessionMessages, compactSession, updateSessionModel } from '@/lib/api';

const SLASH_COMMANDS = [
  { cmd: '/clear', desc: 'Clear chat history for this session' },
  { cmd: '/compact', desc: 'Compact history — keep last 20 messages' },
  { cmd: '/model', desc: 'Switch model, e.g. /model gemma4:e2b' },
] as const;

interface Props {
  sessionId?: string | null;
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  /** Active session's working directory, or undefined if no session/cwd. */
  cwd?: string;
  /** Open the folder picker. */
  onSelectFolder: () => void;
  onCommandFeedback?: (msg: string, ok: boolean) => void;
}

interface AttachedFile {
  path: string;       // absolute path shown in chip
  displayName: string; // basename shown in chip label
}

function basename(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}

/** Fetch a file's content through the Next.js proxy → backend. */
async function fetchFileContent(absPath: string): Promise<string> {
  const res = await fetch(`/api/fs/read?path=${encodeURIComponent(absPath)}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { content?: string };
  return data.content ?? '';
}

export function Composer({ sessionId, onSend, onStop, streaming, disabled, cwd, onSelectFolder, onCommandFeedback }: Props) {
  const [text, setText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [attachInput, setAttachInput] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const mode = useChatStore((s) => s.mode);
  const setMode = useChatStore((s) => s.setMode);
  const autoAccept = useChatStore((s) => s.autoAccept);
  const setAutoAccept = useChatStore((s) => s.setAutoAccept);

  const filteredCmds = SLASH_COMMANDS.filter((c) =>
    c.cmd.startsWith(slashFilter || '/'),
  );

  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = 'auto';
    ref.current.style.height = Math.min(ref.current.scrollHeight, 200) + 'px';
  }, [text]);

  // Focus the attach input when it opens
  useEffect(() => {
    if (attachOpen) attachRef.current?.focus();
  }, [attachOpen]);

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

  async function submit() {
    const trimmed = text.trim();
    if ((!trimmed && attachedFiles.length === 0) || streaming || disabled) return;

    // Handle slash commands
    if (trimmed.startsWith('/') && attachedFiles.length === 0) {
      const handled = await handleSlashCommand(trimmed);
      if (handled) { setText(''); setSlashOpen(false); return; }
    }

    let finalMessage = trimmed;

    // Inject attached file contents before the user's message
    if (attachedFiles.length > 0) {
      const sections: string[] = [];
      for (const f of attachedFiles) {
        try {
          const content = await fetchFileContent(f.path);
          sections.push(`<file path="${f.path}">\n\`\`\`\n${content}\n\`\`\`\n</file>`);
        } catch {
          sections.push(`<file path="${f.path}">[could not read file]</file>`);
        }
      }
      finalMessage = sections.join('\n\n') + (trimmed ? `\n\n${trimmed}` : '');
    }

    onSend(finalMessage);
    setText('');
    setAttachedFiles([]);
    setSlashOpen(false);
  }

  function handleAttachConfirm() {
    const raw = attachInput.trim();
    if (!raw) { setAttachOpen(false); return; }
    // Resolve against cwd if relative
    const absPath = raw.startsWith('/') || /^[A-Za-z]:[/\\]/.test(raw)
      ? raw
      : cwd ? `${cwd}/${raw}` : raw;
    const file: AttachedFile = { path: absPath, displayName: basename(absPath) };
    setAttachedFiles((prev) => prev.some((f) => f.path === absPath) ? prev : [...prev, file]);
    setAttachInput('');
    setAttachOpen(false);
  }

  return (
    <div className="relative border-t border-border bg-bg/40 px-6 py-4">
      {/* Animated progress bar shown while the model is streaming */}
      {streaming && (
        <div className="absolute left-0 right-0 top-0 h-[2px] overflow-hidden">
          <div className="koda-progress h-full w-full" />
        </div>
      )}

      <div className="mx-auto max-w-3xl">
        <div className="koda-glass flex flex-col rounded-2xl p-2 shadow-glow shadow-accent-glow/20">
          {/* Attached file chips */}
          {attachedFiles.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1 px-1">
              {attachedFiles.map((f) => (
                <span
                  key={f.path}
                  className="flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-[11px] text-accent"
                >
                  <Paperclip size={9} />
                  <span className="max-w-[160px] truncate font-mono">{f.displayName}</span>
                  <button
                    onClick={() => setAttachedFiles((prev) => prev.filter((x) => x.path !== f.path))}
                    className="ml-0.5 opacity-60 hover:opacity-100"
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Inline attach-file input */}
          {attachOpen && (
            <div className="mb-1.5 flex items-center gap-1.5 px-1">
              <Paperclip size={11} className="shrink-0 text-accent" />
              <input
                ref={attachRef}
                value={attachInput}
                onChange={(e) => setAttachInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleAttachConfirm(); }
                  if (e.key === 'Escape') { setAttachOpen(false); setAttachInput(''); }
                }}
                placeholder="File path (relative to cwd or absolute)…"
                className="flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-fg-subtle"
              />
              <button onClick={handleAttachConfirm} className="text-[10px] text-accent hover:text-accent-hover">Attach</button>
              <button onClick={() => { setAttachOpen(false); setAttachInput(''); }} className="text-[10px] text-fg-subtle hover:text-fg">Cancel</button>
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

          <div className="flex items-end gap-2">
            <ModeToggle value={mode} onChange={setMode} disabled={streaming || disabled} />

            <textarea
              ref={ref}
              value={text}
              onChange={(e) => {
                const v = e.target.value;
                setText(v);
                if (v.startsWith('/') && !v.includes(' ')) {
                  setSlashFilter(v);
                  setSlashOpen(true);
                } else {
                  setSlashOpen(false);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setSlashOpen(false); return; }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder={
                disabled
                  ? 'Select or create a session…'
                  : mode === 'plan'
                    ? 'Describe what you want planned…'
                    : 'Ask Koda to do something…'
              }
              rows={1}
              disabled={disabled}
              className="flex-1 resize-none bg-transparent px-2 py-1.5 text-[14px] text-fg outline-none placeholder:text-fg-subtle disabled:opacity-50"
            />

            {/* @ attach button */}
            <button
              type="button"
              onClick={() => setAttachOpen((v) => !v)}
              disabled={streaming || disabled}
              title="Attach a file (@)"
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition disabled:opacity-40',
                attachOpen || attachedFiles.length > 0
                  ? 'bg-accent/20 text-accent'
                  : 'text-fg-muted hover:bg-bg-hover hover:text-fg',
              )}
            >
              <Paperclip size={14} />
            </button>

            {streaming ? (
              <button
                onClick={onStop}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-bg-hover text-fg transition hover:bg-bg-subtle"
                aria-label="Stop"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                onClick={() => void submit()}
                disabled={(!text.trim() && attachedFiles.length === 0) || disabled}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white shadow-glow shadow-accent-glow transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                aria-label="Send"
              >
                <Send size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-fg-subtle">
          <button
            type="button"
            onClick={onSelectFolder}
            disabled={streaming}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 font-medium transition disabled:opacity-50',
              cwd
                ? 'border-border bg-bg-subtle/60 text-fg-muted hover:border-accent/40 hover:text-fg'
                : 'border-accent/40 bg-accent/10 text-accent hover:border-accent hover:bg-accent/20',
            )}
            title={cwd ?? 'No folder selected — pick a working directory to start a session'}
          >
            {cwd ? <Folder size={11} /> : <FolderPlus size={11} />}
            <span className="max-w-[180px] truncate">
              {cwd ? basename(cwd) : 'Select folder'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setAutoAccept(!autoAccept)}
            disabled={streaming}
            title={autoAccept ? 'Auto-accept ON — all tool calls approved automatically' : 'Auto-accept OFF — risky tools need approval'}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 font-medium transition disabled:opacity-50',
              autoAccept
                ? 'border-yellow-500/60 bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25'
                : 'border-border bg-bg-subtle/60 text-fg-muted hover:border-accent/40 hover:text-fg',
            )}
          >
            <Zap size={11} />
            <span>{autoAccept ? 'Auto' : 'Manual'}</span>
          </button>

          <span className="flex-1 truncate text-center">
            {autoAccept
              ? 'Auto-accept ON — all tools run without approval prompts'
              : mode === 'plan'
                ? 'Plan mode — read-only exploration. Koda will draft a plan for your approval.'
                : 'Build mode — Koda can edit files and run commands. Risky actions need approval.'}
          </span>
        </div>
      </div>
    </div>
  );
}

interface ModeToggleProps {
  value: SessionMode;
  onChange: (m: SessionMode) => void;
  disabled?: boolean;
}

function ModeToggle({ value, onChange, disabled }: ModeToggleProps) {
  return (
    <div
      className={cn(
        'flex items-center rounded-xl border border-border bg-bg-subtle/60 p-0.5',
        disabled && 'pointer-events-none opacity-60',
      )}
      role="tablist"
      aria-label="Mode"
    >
      <ModeButton
        active={value === 'plan'}
        onClick={() => onChange('plan')}
        icon={<ClipboardList size={12} />}
        label="Plan"
      />
      <ModeButton
        active={value === 'build'}
        onClick={() => onChange('build')}
        icon={<Hammer size={12} />}
        label="Build"
      />
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={cn(
        'flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium transition',
        active
          ? 'bg-accent text-white shadow-sm'
          : 'text-fg-muted hover:bg-bg-hover hover:text-fg',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
