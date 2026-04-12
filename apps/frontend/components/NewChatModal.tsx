'use client';

import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Loader2, X, AlertCircle, Folder } from 'lucide-react';
import type { Session } from '@koda/shared';
import { createSession } from '@/lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (session: Session) => void;
  /** Recently used cwds, surfaced as quick-pick chips. */
  recentCwds?: string[];
}

/**
 * Modal that asks the user where to root the new chat (working directory),
 * mirroring how Claude Code ties each session to a project folder. The path
 * is validated server-side; backend errors are surfaced inline.
 */
export function NewChatModal({ open, onClose, onCreated, recentCwds = [] }: Props) {
  const [cwd, setCwd] = useState('');
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state and focus the path input each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setCwd('');
    setTitle('');
    setError(null);
    setCreating(false);
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !creating) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, creating, onClose]);

  if (!open) return null;

  async function handleCreate() {
    if (creating) return;
    setError(null);
    setCreating(true);
    try {
      const session = await createSession({
        title: title.trim() || undefined,
        cwd: cwd.trim() || undefined,
      });
      onCreated(session);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }

  function pick(path: string) {
    setCwd(path);
    inputRef.current?.focus();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={() => !creating && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-chat-title"
    >
      <div
        className="koda-glass w-full max-w-lg rounded-2xl shadow-glow shadow-accent-glow"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-2">
            <FolderOpen size={16} className="text-accent" />
            <h2 id="new-chat-title" className="text-[14px] font-semibold tracking-tight text-fg">
              Start a new chat
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={creating}
            className="rounded p-1 text-fg-subtle transition hover:bg-bg-hover hover:text-fg disabled:opacity-40"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label
              htmlFor="cwd-input"
              className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-fg-subtle"
            >
              Working directory
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-subtle px-2.5 py-2 focus-within:border-accent/50">
              <Folder size={13} className="shrink-0 text-fg-subtle" />
              <input
                ref={inputRef}
                id="cwd-input"
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                }}
                placeholder="C:\path\to\your\project   (leave empty to use the server default)"
                disabled={creating}
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-fg outline-none placeholder:text-fg-subtle disabled:opacity-50"
              />
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-fg-subtle">
              Koda will read, edit, and run commands inside this folder only. Must be an absolute
              path that exists on this machine.
            </p>
          </div>

          {recentCwds.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                Recent
              </div>
              <div className="flex flex-wrap gap-1.5">
                {recentCwds.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => pick(p)}
                    disabled={creating}
                    className="max-w-full truncate rounded-full border border-border bg-bg-subtle/60 px-2.5 py-1 font-mono text-[11px] text-fg-muted transition hover:border-accent/40 hover:text-fg disabled:opacity-50"
                    title={p}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label
              htmlFor="title-input"
              className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-fg-subtle"
            >
              Title <span className="font-normal normal-case text-fg-subtle">(optional)</span>
            </label>
            <input
              id="title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
              }}
              placeholder="New chat"
              disabled={creating}
              className="w-full rounded-lg border border-border bg-bg-subtle px-2.5 py-2 text-[13px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent/50 disabled:opacity-50"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-3">
          <button
            onClick={onClose}
            disabled={creating}
            className="rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium text-fg-muted transition hover:bg-bg-hover hover:text-fg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12px] font-medium text-white shadow-glow shadow-accent-glow transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? <Loader2 size={12} className="animate-spin" /> : null}
            {creating ? 'Creating…' : 'Create chat'}
          </button>
        </div>
      </div>
    </div>
  );
}
