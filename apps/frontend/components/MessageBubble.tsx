'use client';

import { useEffect, useState } from 'react';
import { User, Check, Copy } from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { Logo } from './Logo';
import { cn } from '@/lib/cn';

interface Props {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
  startedAt?: number;
}

export function MessageBubble({ role, text, streaming, startedAt }: Props) {
  const isUser = role === 'user';
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Tick while streaming so elapsed time updates live
  useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [streaming]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }

  // Empty assistant message while waiting for first token: shimmer placeholder
  const showShimmer = !isUser && !text && streaming;

  const durationMs = !isUser && startedAt ? (streaming ? now : Date.now()) - startedAt : null;
  // Show the elapsed timer while streaming AND after — it ticks live during thinking,
  // then freezes at the final value once the response is complete.
  const durationLabel = durationMs != null && durationMs > 0 ? formatDuration(durationMs) : null;

  return (
    <div className="group flex gap-3 px-6 py-4">
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border',
          isUser ? 'bg-bg-subtle' : 'overflow-hidden bg-transparent',
        )}
      >
        {isUser ? <User size={14} /> : <Logo size={26} />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <div className="text-xs font-medium text-fg-muted">{isUser ? 'You' : 'Koda'}</div>
          {!isUser && text && !streaming && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-fg-subtle opacity-0 transition hover:bg-bg-hover hover:text-fg group-hover:opacity-100"
              aria-label="Copy message"
            >
              {copied ? <Check size={10} /> : <Copy size={10} />}
              {copied ? 'copied' : 'copy'}
            </button>
          )}
          {durationLabel && (
            <span className="ml-auto text-[10px] tabular-nums text-fg-subtle">{durationLabel}</span>
          )}
        </div>

        {isUser ? (
          <div className="whitespace-pre-wrap break-words text-[14px] text-fg">{text}</div>
        ) : showShimmer ? (
          <div className="space-y-2 py-1">
            <div className="koda-shimmer h-3 w-3/5 rounded" />
            <div className="koda-shimmer h-3 w-2/5 rounded" />
          </div>
        ) : (
          <div className="relative">
            <MarkdownRenderer>{text}</MarkdownRenderer>
            {streaming && <span className="koda-caret">▍</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
