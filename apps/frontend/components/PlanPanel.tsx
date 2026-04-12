'use client';

import { useState } from 'react';
import { Check, ClipboardList, Loader2 } from 'lucide-react';
import { approvePlan } from '@/lib/api';
import { useChatStore } from '@/lib/store';
import { MarkdownRenderer } from './MarkdownRenderer';

interface Props {
  sessionId: string;
  content: string;
}

/**
 * Right-side dock that displays the current plan markdown and lets the
 * user approve it (which switches the session from plan → build mode on
 * the backend and emits a mode_change event over SSE).
 */
export function PlanPanel({ sessionId, content }: Props) {
  const setMode = useChatStore((s) => s.setMode);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setApproving(true);
    setError(null);
    try {
      await approvePlan(sessionId);
      // Optimistically flip locally; backend will also emit mode_change
      // on the next chat turn so the SSE stream stays consistent.
      setMode('build');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApproving(false);
    }
  }

  return (
    <aside className="flex h-full w-[420px] shrink-0 flex-col border-l border-border bg-bg-panel/80 backdrop-blur">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <ClipboardList size={14} className="text-accent-2" />
          <span className="text-[13px] font-semibold tracking-tight text-fg">Plan</span>
        </div>
        <button
          onClick={handleApprove}
          disabled={approving}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white shadow-glow shadow-accent-glow transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {approving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          {approving ? 'Approving…' : 'Approve & Build'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <MarkdownRenderer>{content}</MarkdownRenderer>
        {error && (
          <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
            {error}
          </div>
        )}
      </div>
    </aside>
  );
}
