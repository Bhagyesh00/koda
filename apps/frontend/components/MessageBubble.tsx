'use client';

import { useState } from 'react';
import { User, Check, Copy } from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { Logo } from './Logo';
import { cn } from '@/lib/cn';

interface Props {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
}

export function MessageBubble({ role, text, streaming }: Props) {
  const isUser = role === 'user';
  const [copied, setCopied] = useState(false);

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
  const showThinking = !isUser && !text && streaming;

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
        </div>

        {isUser ? (
          <div className="whitespace-pre-wrap break-words text-[14px] text-fg">{text}</div>
        ) : showThinking ? (
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
