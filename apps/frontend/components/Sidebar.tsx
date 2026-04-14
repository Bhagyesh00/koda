'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, MessageSquare, Folder, Pencil, Search, Check, X, GitBranch } from 'lucide-react';
import { listSessions, deleteSession, renameSession, branchSession, type SessionSummary } from '@/lib/api';
import { useChatStore } from '@/lib/store';
import { cn } from '@/lib/cn';
import { Logo } from './Logo';
import { ModePill } from './ModePill';
import { NewChatModal } from './NewChatModal';

interface Props {
  activeId: string | null;
  onSelect: (id: string) => void;
  modalOpen: boolean;
  onModalOpenChange: (v: boolean) => void;
  /**
   * What "New chat" does. Default opens the legacy modal; pass a callback
   * to instead clear the active session and let the user pick a folder
   * from the composer's "Select folder" pill (Claude-Code-style flow).
   */
  onNewChat?: () => void;
  onBranch?: (branchedId: string) => void;
}

export function Sidebar({ activeId, onSelect, modalOpen, onModalOpenChange, onNewChat, onBranch }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const mode = useChatStore((s) => s.mode);
  const addToast = useChatStore((s) => s.addToast);

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

  // Focus input when entering edit mode
  useEffect(() => {
    if (editingId) {
      setTimeout(() => editInputRef.current?.focus(), 0);
    }
  }, [editingId]);

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

  const filteredSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  async function handleBranch(s: SessionSummary, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const branched = await branchSession(s.id, s.messageCount);
      await refresh();
      addToast(`Branched from "${s.title}"`, 'success');
      onBranch?.(branched.id);
      onSelect(branched.id);
    } catch (err) {
      addToast((err as Error).message, 'error');
    }
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await deleteSession(id);
    await refresh();
    addToast('Session deleted', 'success');
    if (activeId === id) onSelect('');
  }

  function startEditing(id: string, title: string, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingId(id);
    setEditTitle(title);
  }

  async function commitRename(id: string) {
    const trimmed = editTitle.trim();
    setEditingId(null);
    if (!trimmed) return;
    const session = sessions.find((s) => s.id === id);
    if (session && trimmed === session.title) return;
    try {
      await renameSession(id, trimmed);
      await refresh();
      addToast('Session renamed', 'success');
    } catch (err) {
      addToast((err as Error).message, 'error');
    }
  }

  function cancelEditing() {
    setEditingId(null);
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
          onClick={() => (onNewChat ? onNewChat() : onModalOpenChange(true))}
          className="m-3 flex items-center justify-center gap-2 rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm font-medium text-fg transition hover:border-accent/40 hover:bg-bg-hover"
        >
          <Plus size={16} /> New chat
          <span className="ml-auto text-[10px] text-fg-subtle">⌘K</span>
        </button>

        {/* Search */}
        {sessions.length > 0 && (
          <div className="px-3 pb-2">
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-bg-subtle px-2 py-1.5">
              <Search size={11} className="shrink-0 text-fg-subtle" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search sessions…"
                className="flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-fg-subtle"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="text-fg-subtle hover:text-fg">
                  <X size={10} />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {sessions.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-fg-subtle">No sessions yet</div>
          )}
          {sessions.length > 0 && filteredSessions.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-fg-subtle">No results</div>
          )}
          {filteredSessions.map((s) => (
            <div
              key={s.id}
              onClick={() => editingId !== s.id && onSelect(s.id)}
              className={cn(
                'group mb-1 flex cursor-pointer flex-col gap-0.5 rounded-md px-3 py-2 text-sm transition',
                activeId === s.id
                  ? 'bg-bg-hover text-fg shadow-inset-border'
                  : 'text-fg-muted hover:bg-bg-subtle',
              )}
            >
              <div className="flex items-center gap-2">
                {s.parentId
                  ? <GitBranch size={12} className="shrink-0 text-accent-2" />
                  : <MessageSquare size={14} className="shrink-0" />
                }
                {editingId === s.id ? (
                  <input
                    ref={editInputRef}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(s.id);
                      if (e.key === 'Escape') cancelEditing();
                    }}
                    onBlur={() => void commitRename(s.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 rounded border border-accent/50 bg-bg-subtle px-1.5 py-0.5 text-[12px] text-fg outline-none focus:border-accent"
                  />
                ) : (
                  <span className="flex-1 truncate">{s.title}</span>
                )}
                {editingId === s.id ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); void commitRename(s.id); }}
                    className="shrink-0 text-accent hover:text-accent-hover"
                    aria-label="Confirm rename"
                  >
                    <Check size={12} />
                  </button>
                ) : (
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
                    <button
                      onClick={(e) => void handleBranch(s, e)}
                      className="hover:text-accent"
                      aria-label="Branch session"
                      title="Branch from latest state"
                    >
                      <GitBranch size={12} />
                    </button>
                    <button
                      onClick={(e) => startEditing(s.id, s.title, e)}
                      className="hover:text-accent"
                      aria-label="Rename session"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={(e) => void handleDelete(s.id, e)}
                      className="hover:text-accent"
                      aria-label="Delete session"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
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
        onClose={() => onModalOpenChange(false)}
        recentCwds={recentCwds}
        onCreated={(s) => {
          onModalOpenChange(false);
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
