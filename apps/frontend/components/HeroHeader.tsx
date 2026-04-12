'use client';

import { useEffect, useState } from 'react';
import { useChatStore } from '@/lib/store';
import { getSession } from '@/lib/api';
import { ModePill } from './ModePill';

interface Props {
  sessionId: string | null;
}

/**
 * Top header bar for the active session: shows the session title,
 * the current mode pill, and a subtle live status indicator.
 */
export function HeroHeader({ sessionId }: Props) {
  const mode = useChatStore((s) => s.mode);
  const streaming = useChatStore((s) => s.streaming);
  const [title, setTitle] = useState<string>('New session');

  useEffect(() => {
    if (!sessionId) {
      setTitle('New session');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const s = await getSession(sessionId);
        if (!cancelled) setTitle(s.title || 'New session');
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <header className="flex items-center justify-between border-b border-border bg-bg-panel/60 px-6 py-3 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="truncate text-[14px] font-semibold tracking-tight text-fg">{title}</h1>
        {streaming && (
          <span className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
            <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-accent" />
            thinking
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <ModePill mode={mode} />
      </div>
    </header>
  );
}
