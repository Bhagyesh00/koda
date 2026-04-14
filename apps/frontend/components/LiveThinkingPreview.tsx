'use client';

import { Brain } from 'lucide-react';
import { useChatStore } from '@/lib/store';

/**
 * Streams the in-progress <think> block content while the LLM is responding.
 * Hidden if there's no live thinking yet. Replaced by a frozen ThinkingBlock
 * once the message_end event arrives and the canonical thinking SSE fires.
 */
export function LiveThinkingPreview() {
  const live = useChatStore((s) => s.liveThinking);
  if (!live || !live.text.trim()) return null;

  return (
    <div className="mx-6 my-2 flex gap-3">
      <div className="w-[2px] shrink-0 rounded-full bg-accent-2/50" />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-accent-2">
          <Brain size={11} className="animate-pulse" />
          <span>Thinking…</span>
        </div>
        <pre className="whitespace-pre-wrap break-words font-sans text-[12px] italic leading-relaxed text-fg-muted">
          {live.text}
        </pre>
      </div>
    </div>
  );
}
