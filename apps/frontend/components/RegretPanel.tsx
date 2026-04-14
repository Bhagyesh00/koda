'use client';

import { History, X, AlertTriangle } from 'lucide-react';
import { useChatStore } from '@/lib/store';

interface Props {
  onClose: () => void;
}

function formatSpan(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.round(mins / 60)}h`;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export function RegretPanel({ onClose }: Props) {
  const regrets = useChatStore((s) => s.regrets);

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-bg-panel/90 backdrop-blur">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <History size={14} className="text-accent-2" />
          <span className="text-[13px] font-semibold text-fg">Regret Journal</span>
          {regrets.length > 0 && (
            <span className="rounded-full bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400">
              {regrets.length}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-fg-subtle hover:text-fg"><X size={14} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 text-[12px]">
        {regrets.length === 0 ? (
          <div className="py-8 text-center text-fg-subtle">
            <History size={28} className="mx-auto mb-3 opacity-20" />
            <p>No thrash patterns detected yet.</p>
            <p className="mt-1 text-[11px]">Koda flags files it edits repeatedly in a short window.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {regrets.map((r, idx) => (
              <div key={idx} className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0 text-yellow-400" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-mono text-[11px] font-medium text-fg" title={r.path}>
                      {r.path.split(/[\\/]/).pop() ?? r.path}
                    </div>
                    <div className="mt-0.5 text-[10px] text-fg-subtle">
                      Edited <span className="text-yellow-400">{r.editCount}× in {formatSpan(r.timespanMs)}</span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-fg-subtle">{relativeTime(r.ts)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border px-3 py-2 text-[11px] text-fg-subtle">
        Flags thrash patterns: repeated edits or reverted changes to the same file.
      </div>
    </aside>
  );
}
