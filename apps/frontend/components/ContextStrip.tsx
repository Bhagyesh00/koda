'use client';

import { BookOpen } from 'lucide-react';
import { useChatStore } from '@/lib/store';

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/**
 * Compact horizontal strip showing the most recently read files in the
 * current session. Sits above the composer and stays out of the way until
 * something has been read. Click "See all" to open the full ContextLensPanel.
 */
export function ContextStrip() {
  const contextFiles = useChatStore((s) => s.contextFiles);
  const setContextLensOpen = useChatStore((s) => s.setContextLensOpen);

  const files = contextFiles.filter((f) => !f.startsWith('glob:')).slice(-10);
  if (files.length === 0) return null;

  return (
    <div className="flex items-center gap-2 border-t border-border bg-bg/40 px-4 py-1.5">
      <BookOpen size={10} className="shrink-0 text-fg-subtle" />
      <span className="shrink-0 text-[10px] uppercase tracking-wider text-fg-subtle">
        Context
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {files.map((f) => (
          <span
            key={f}
            title={f}
            className="shrink-0 truncate rounded bg-bg-subtle/60 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted hover:text-fg"
          >
            {basename(f)}
          </span>
        ))}
      </div>
      <button
        onClick={() => setContextLensOpen(true)}
        className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] text-fg-subtle hover:text-fg"
      >
        See all
      </button>
    </div>
  );
}
