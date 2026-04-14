'use client';

import { useEffect, useState } from 'react';
import { Camera, RotateCcw, Clock, X, Plus } from 'lucide-react';
import { listSnapshots, restoreSnapshot } from '@/lib/api';
import { useChatStore } from '@/lib/store';

interface Props {
  sessionId: string;
  onClose: () => void;
}

interface Snapshot {
  ref: string;
  description: string;
  ts: number;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function SnapshotTimeline({ sessionId, onClose }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [creating, setCreating] = useState(false);
  const [description, setDescription] = useState('');
  const [restoring, setRestoring] = useState<string | null>(null);
  const addToast = useChatStore((s) => s.addToast);

  async function load() {
    try {
      setSnapshots(await listSnapshots(sessionId));
    } catch { /* noop */ }
  }

  useEffect(() => { void load(); }, [sessionId]);

  async function handleCreate() {
    if (!description.trim()) return;
    setCreating(true);
    try {
      const r = await fetch(`/api/sessions/${sessionId}/snapshots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: description.trim() }),
      });
      if (!r.ok) throw new Error(`snapshot failed (${r.status})`);
      addToast('Snapshot created', 'success');
      setDescription('');
      await load();
    } catch (e) {
      addToast((e as Error).message, 'error');
    } finally {
      setCreating(false);
    }
  }

  async function handleRestore(ref: string) {
    setRestoring(ref);
    try {
      await restoreSnapshot(sessionId, ref);
      addToast('Workspace restored', 'success');
    } catch (e) {
      addToast((e as Error).message, 'error');
    } finally {
      setRestoring(null);
    }
  }

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-l border-border bg-bg-panel/90 backdrop-blur">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Camera size={14} className="text-accent-2" />
          <span className="text-[13px] font-semibold text-fg">Snapshots</span>
          {snapshots.length > 0 && (
            <span className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              {snapshots.length}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-fg-subtle hover:text-fg"><X size={14} /></button>
      </div>

      {/* Create snapshot */}
      <div className="border-b border-border p-3">
        <div className="flex gap-2">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
            placeholder="Snapshot description…"
            className="flex-1 rounded border border-border bg-bg px-2.5 py-1.5 text-[12px] text-fg outline-none focus:border-accent"
          />
          <button
            onClick={() => void handleCreate()}
            disabled={creating || !description.trim()}
            className="flex items-center gap-1 rounded bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition"
          >
            <Plus size={11} /> {creating ? '…' : 'Save'}
          </button>
        </div>
        <p className="mt-1 text-[10px] text-fg-subtle">
          Uses git stash if git is available, otherwise copies files.
        </p>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto">
        {snapshots.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-fg-subtle">
            <Camera size={28} className="mx-auto mb-3 opacity-20" />
            <p>No snapshots yet.</p>
          </div>
        ) : (
          <div className="relative px-3 py-3">
            {/* Vertical timeline line */}
            <div className="absolute left-5 top-3 bottom-3 w-px bg-border" />

            <div className="space-y-3">
              {[...snapshots].reverse().map((snap) => (
                <div key={snap.ref} className="relative flex items-start gap-3">
                  {/* Node */}
                  <div className="relative z-10 mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-bg-panel">
                    <div className="h-1.5 w-1.5 rounded-full bg-accent" />
                  </div>
                  <div className="flex-1 min-w-0 rounded-lg border border-border bg-bg-subtle p-2.5">
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-medium text-fg">{snap.description}</div>
                        <div className="flex items-center gap-1 mt-0.5 text-[10px] text-fg-subtle">
                          <Clock size={9} />
                          {relativeTime(snap.ts)}
                        </div>
                      </div>
                      <button
                        onClick={() => void handleRestore(snap.ref)}
                        disabled={restoring === snap.ref}
                        title="Restore to this snapshot"
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-fg-subtle hover:bg-bg-hover hover:text-fg transition disabled:opacity-50"
                      >
                        {restoring === snap.ref ? '…' : <RotateCcw size={11} />}
                      </button>
                    </div>
                    <div className="mt-1 truncate font-mono text-[9px] text-fg-subtle" title={snap.ref}>
                      {snap.ref.slice(0, 12)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
