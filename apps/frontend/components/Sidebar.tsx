'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, MessageSquare, Folder } from 'lucide-react';
import { listSessions, deleteSession, type SessionSummary } from '@/lib/api';
import { useChatStore } from '@/lib/store';
import { cn } from '@/lib/cn';
import { Logo } from './Logo';
import { ModePill } from './ModePill';
import { NewChatModal } from './NewChatModal';

interface Props {
  activeId: string | null;
  onSelect: (id: string) => void;
}

export function Sidebar({ activeId, onSelect }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const mode = useChatStore((s) => s.mode);

  async function refresh() {
    try {
      setSessions(await listSessions());
    } catch {
      /* noop */
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Recently used cwds (deduped, most recent first) — surfaced in the modal as quick picks.
  const recentCwds = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const s of sessions) {
      if (!s.cwd || seen.has(s.cwd)) continue;
      seen.add(s.cwd);
      list.push(s.cwd);
      if (list.length >= 5) break;
    }
    return list;
  }, [sessions]);

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await deleteSession(id);
    await refresh();
    if (activeId === id) onSelect('');
  }

  const activeSession = sessions.find((s) => s.id === activeId);

  return (
    <>
      <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-bg-panel">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Logo size={26} animated />
            <div className="flex flex-col leading-none">
              <span className="font-semibold tracking-tight text-fg">Koda</span>
              <span className="mt-0.5 text-[10px] uppercase tracking-wider text-fg-subtle">
                private agent
              </span>
            </div>
          </div>
          <ModePill mode={mode} />
        </div>

        <button
          onClick={() => setModalOpen(true)}
          className="m-3 flex items-center justify-center gap-2 rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm font-medium text-fg transition hover:border-accent/40 hover:bg-bg-hover"
        >
          <Plus size={16} /> New chat
        </button>

        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {sessions.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-fg-subtle">No sessions yet</div>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={cn(
                'group mb-1 flex cursor-pointer flex-col gap-0.5 rounded-md px-3 py-2 text-sm transition',
                activeId === s.id
                  ? 'bg-bg-hover text-fg shadow-inset-border'
                  : 'text-fg-muted hover:bg-bg-subtle',
              )}
            >
              <div className="flex items-center gap-2">
                <MessageSquare size={14} className="shrink-0" />
                <span className="flex-1 truncate">{s.title}</span>
                <button
                  onClick={(e) => handleDelete(s.id, e)}
                  className="opacity-0 transition group-hover:opacity-100 hover:text-accent"
                  aria-label="Delete session"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {s.cwd && (
                <div className="ml-6 flex items-center gap-1 truncate font-mono text-[10px] text-fg-subtle">
                  <Folder size={9} className="shrink-0" />
                  <span className="truncate" title={s.cwd}>
                    {compactPath(s.cwd)}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="border-t border-border px-4 py-3 text-[11px] leading-relaxed text-fg-subtle">
          {activeSession?.cwd ? (
            <span className="break-all font-mono" title={activeSession.cwd}>
              {activeSession.cwd}
            </span>
          ) : (
            'Runs entirely on your machine. Tool calls that touch the filesystem require your approval.'
          )}
        </div>
      </aside>

      <NewChatModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        recentCwds={recentCwds}
        onCreated={(s) => {
          setModalOpen(false);
          void refresh();
          onSelect(s.id);
        }}
      />
    </>
  );
}

/** Trim long paths for display, keeping the leaf two segments. */
function compactPath(p: string): string {
  if (p.length <= 36) return p;
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(sep).filter(Boolean);
  if (parts.length <= 3) return p;
  return `…${sep}${parts.slice(-2).join(sep)}`;
}
