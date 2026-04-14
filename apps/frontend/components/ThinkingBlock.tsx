'use client';

import { useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  text: string;
}

/**
 * Frozen post-stream thinking block. Open by default with a small toggle to
 * collapse. Uses the same tree-line indent as ToolCallCard / LiveThinkingPreview
 * so the agent log feels like a single visual stream.
 */
export function ThinkingBlock({ text }: Props) {
  const [open, setOpen] = useState(true);

  return (
    <div className="mx-6 my-2 flex gap-3">
      <div className="w-[2px] shrink-0 rounded-full bg-accent-2/40" />
      <div className="min-w-0 flex-1">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] text-fg-subtle transition hover:text-fg"
        >
          {open
            ? <ChevronDown size={11} className="shrink-0" />
            : <ChevronRight size={11} className="shrink-0" />
          }
          <Brain size={11} className="shrink-0 text-accent-2/80" />
          <span>{open ? 'Hide thinking' : 'Show thinking'}</span>
        </button>
        {open && (
          <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-[12px] italic leading-relaxed text-fg-muted">
            {text}
          </pre>
        )}
      </div>
    </div>
  );
}
