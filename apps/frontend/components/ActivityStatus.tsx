'use client';

import { Brain, FileText, FilePlus2, Terminal, Loader2 } from 'lucide-react';
import { useChatStore, type DisplayMessage } from '@/lib/store';

/**
 * Inline hand-off hint rendered at the tail of the chat thread while the
 * agent is working. Hides itself whenever something more specific is already
 * showing (live thinking preview, or a pending/in-flight tool call).
 *
 * Hand-off chain: LiveThinkingPreview → InlineActivityHint → ToolCallCard spinner
 */
export function InlineActivityHint() {
  const activity = useChatStore((s) => s.activity);
  const streaming = useChatStore((s) => s.streaming);
  const liveThinking = useChatStore((s) => s.liveThinking);
  const messages = useChatStore((s) => s.messages);

  if (!streaming || !activity || activity.phase === 'idle') return null;

  // Live thinking preview already shows the same signal — defer to it.
  if (liveThinking && liveThinking.text.trim()) return null;

  // If the last message is a tool call that's in flight, defer to its spinner.
  const last: DisplayMessage | undefined = messages[messages.length - 1];
  if (
    last &&
    last.kind === 'tool' &&
    (last.status === 'pending' || last.status === 'approved')
  ) {
    return null;
  }

  const { phase, tool } = activity;
  const label =
    phase === 'thinking'
      ? 'Thinking…'
      : phase === 'reading'
        ? `Reading${tool ? ` · ${tool}` : ''}…`
        : phase === 'writing'
          ? `Writing${tool ? ` · ${tool}` : ''}…`
          : phase === 'running'
            ? 'Running command…'
            : '';

  const Icon =
    phase === 'thinking'
      ? Brain
      : phase === 'reading'
        ? FileText
        : phase === 'writing'
          ? FilePlus2
          : phase === 'running'
            ? Terminal
            : Loader2;

  return (
    <div className="mx-6 my-2 flex gap-3">
      <div className="w-[2px] shrink-0 rounded-full bg-accent/40" />
      <div className="flex items-center gap-1.5 py-0.5 text-[11.5px] text-fg-subtle">
        <Icon size={11} className="shrink-0 animate-pulse text-accent" />
        <span>{label}</span>
      </div>
    </div>
  );
}

// Backwards-compat export for any caller still importing ActivityStatus
export const ActivityStatus = InlineActivityHint;
