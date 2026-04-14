'use client';

import { useState } from 'react';
import { X, Rewind, GitBranchPlus } from 'lucide-react';
import { counterfactualReplay } from '@/lib/api';
import { useChatStore } from '@/lib/store';

interface Props {
  sessionId: string;
  callId: string;
  originalContent: string;
  onClose: () => void;
  onReplayCreated: (newSessionId: string) => void;
}

export function CounterfactualModal({
  sessionId,
  callId,
  originalContent,
  onClose,
  onReplayCreated,
}: Props) {
  const [edited, setEdited] = useState(originalContent);
  const [submitting, setSubmitting] = useState(false);
  const addToast = useChatStore((s) => s.addToast);

  async function submit() {
    if (edited === originalContent) {
      addToast('No changes — edit the result first', 'info');
      return;
    }
    setSubmitting(true);
    try {
      const child = await counterfactualReplay(sessionId, callId, edited);
      addToast('Counterfactual branch created', 'success');
      onReplayCreated(child.id);
      onClose();
    } catch (e) {
      addToast((e as Error).message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="flex h-[70vh] w-[700px] max-w-[95vw] flex-col rounded-2xl border border-border bg-bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Rewind size={14} className="text-accent-2" />
            <span className="text-[14px] font-semibold text-fg">Counterfactual Replay</span>
          </div>
          <button onClick={onClose} className="text-fg-subtle hover:text-fg"><X size={15} /></button>
        </div>

        <div className="px-5 py-3 border-b border-border">
          <p className="text-[12px] text-fg-subtle">
            Edit this tool result to create an alternate timeline. Koda will fork the session and continue from that point with the edited result.
          </p>
        </div>

        <div className="flex flex-1 flex-col p-5 min-h-0">
          <label className="mb-1.5 text-[11px] uppercase tracking-wider text-fg-subtle">
            Tool result
          </label>
          <textarea
            value={edited}
            onChange={(e) => setEdited(e.target.value)}
            className="flex-1 resize-none rounded border border-border bg-bg p-3 font-mono text-[12px] text-fg outline-none focus:border-accent"
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button
            onClick={onClose}
            className="rounded border border-border px-4 py-1.5 text-[12px] text-fg-muted hover:bg-bg-hover"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitting || edited === originalContent}
            className="flex items-center gap-1.5 rounded bg-accent px-4 py-1.5 text-[12px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            <GitBranchPlus size={12} />
            {submitting ? 'Creating…' : 'Create counterfactual branch'}
          </button>
        </div>
      </div>
    </div>
  );
}
