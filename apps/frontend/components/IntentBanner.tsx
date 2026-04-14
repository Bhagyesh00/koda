'use client';

import { useEffect, useState } from 'react';
import { Pin, PinOff, AlertTriangle, X, Edit3 } from 'lucide-react';
import { useChatStore } from '@/lib/store';
import { setPinnedIntent } from '@/lib/api';
import { cn } from '@/lib/cn';

interface Props {
  sessionId: string | null;
}

export function IntentBanner({ sessionId }: Props) {
  const pinnedIntent = useChatStore((s) => s.pinnedIntent);
  const driftWarning = useChatStore((s) => s.driftWarning);
  const setPinnedIntentLocal = useChatStore((s) => s.setPinnedIntentLocal);
  const setDriftWarning = useChatStore((s) => s.setDriftWarning);
  const addToast = useChatStore((s) => s.addToast);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setDraft(pinnedIntent ?? '');
  }, [pinnedIntent]);

  async function save() {
    if (!sessionId) return;
    const val = draft.trim() || null;
    try {
      await setPinnedIntent(sessionId, val);
      setPinnedIntentLocal(val);
      addToast(val ? 'Intent pinned' : 'Intent cleared', 'success');
    } catch (e) {
      addToast((e as Error).message, 'error');
    }
    setEditing(false);
  }

  async function unpin() {
    if (!sessionId) return;
    try {
      await setPinnedIntent(sessionId, null);
      setPinnedIntentLocal(null);
      addToast('Intent unpinned', 'success');
    } catch (e) {
      addToast((e as Error).message, 'error');
    }
  }

  if (!sessionId) return null;

  // Not pinned + not editing → show a compact "+ pin intent" link
  if (!pinnedIntent && !editing) {
    return (
      <div className="border-b border-border bg-bg-panel/40 px-4 py-1.5">
        <button
          onClick={() => setEditing(true)}
          className="flex items-center gap-1.5 text-[11px] text-fg-subtle hover:text-fg transition"
        >
          <Pin size={10} /> Pin an intent — warns if Koda drifts off-goal
        </button>
      </div>
    );
  }

  return (
    <div className={cn(
      'border-b px-4 py-2',
      driftWarning ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-accent/20 bg-accent/5',
    )}>
      <div className="flex items-start gap-2">
        <Pin size={12} className={cn('mt-0.5 shrink-0', driftWarning ? 'text-yellow-400' : 'text-accent')} />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-fg-subtle">Pinned intent</div>
          {editing ? (
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save();
                if (e.key === 'Escape') setEditing(false);
              }}
              autoFocus
              placeholder="e.g. Add OAuth login flow to /login endpoint"
              className="mt-0.5 w-full bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-subtle"
            />
          ) : (
            <div className="mt-0.5 text-[13px] text-fg">{pinnedIntent}</div>
          )}
          {driftWarning && !editing && (
            <div className="mt-1 flex items-start gap-1.5 text-[11px] text-yellow-300">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span>This action may not serve your pinned intent: <code className="rounded bg-bg-hover px-1 font-mono text-[10px]">{driftWarning.action.slice(0, 80)}</code></span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {editing ? (
            <button onClick={() => void save()} className="rounded bg-accent px-2 py-0.5 text-[10px] font-medium text-white">
              Save
            </button>
          ) : (
            <>
              {driftWarning && (
                <button
                  onClick={() => setDriftWarning(null)}
                  className="text-fg-subtle hover:text-fg"
                  title="Dismiss warning"
                >
                  <X size={11} />
                </button>
              )}
              <button onClick={() => setEditing(true)} className="text-fg-subtle hover:text-fg">
                <Edit3 size={11} />
              </button>
              <button onClick={() => void unpin()} className="text-fg-subtle hover:text-fg" title="Unpin">
                <PinOff size={11} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
