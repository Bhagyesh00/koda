'use client';

import { useState } from 'react';
import { Brain, ChevronDown, ChevronUp } from 'lucide-react';
import { useChatStore } from '@/lib/store';

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function MemoryRecallCard() {
  const matches = useChatStore((s) => s.memoryRecall);
  const setMemoryRecall = useChatStore((s) => s.setMemoryRecall);
  const [expanded, setExpanded] = useState(false);

  if (matches.length === 0) return null;

  return (
    <div className="mx-6 my-2 rounded-lg border border-accent-2/30 bg-accent-2/5 p-2.5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <Brain size={12} className="shrink-0 text-accent-2" />
        <span className="flex-1 text-[11px] font-medium text-accent-2">
          I've seen {matches.length === 1 ? 'a similar question' : `${matches.length} similar questions`} before
        </span>
        {expanded
          ? <ChevronUp size={12} className="text-fg-subtle" />
          : <ChevronDown size={12} className="text-fg-subtle" />
        }
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {matches.map((m, i) => (
            <div key={i} className="rounded border border-border bg-bg-subtle p-2 text-[11px]">
              <div className="mb-1 flex items-center justify-between text-[10px] text-fg-subtle">
                <span>Relevance: {(m.score * 100).toFixed(0)}%</span>
                <span>{relativeTime(m.ts)}</span>
              </div>
              <pre className="whitespace-pre-wrap break-words font-sans text-fg-muted">
                {m.excerpt}
              </pre>
            </div>
          ))}
          <button
            onClick={() => setMemoryRecall([])}
            className="text-[10px] text-fg-subtle hover:text-fg"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
