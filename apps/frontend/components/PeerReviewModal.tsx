'use client';

import { useEffect, useState } from 'react';
import { X, Users, Loader2 } from 'lucide-react';
import { peerReview, type PeerReviewResult } from '@/lib/api';
import { useChatStore } from '@/lib/store';

interface Props {
  sessionId: string;
  onClose: () => void;
}

export function PeerReviewModal({ sessionId, onClose }: Props) {
  const [result, setResult] = useState<PeerReviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const addToast = useChatStore((s) => s.addToast);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await peerReview(sessionId);
        if (!cancelled) setResult(r);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  function copy(content: string) {
    navigator.clipboard.writeText(content).then(
      () => addToast('Copied to clipboard', 'success'),
      () => addToast('Copy failed', 'error'),
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="flex h-[85vh] w-[1100px] max-w-[97vw] flex-col rounded-2xl border border-border bg-bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Users size={14} className="text-accent-2" />
            <span className="text-[14px] font-semibold text-fg">Peer Review</span>
            <span className="text-[11px] text-fg-subtle">— two parallel generations, diff them yourself</span>
          </div>
          <button onClick={onClose} className="text-fg-subtle hover:text-fg"><X size={15} /></button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {loading ? (
            <div className="flex flex-1 items-center justify-center text-fg-subtle">
              <Loader2 size={24} className="mr-2 animate-spin" />
              Running two parallel generations…
            </div>
          ) : error ? (
            <div className="flex flex-1 items-center justify-center text-red-400">{error}</div>
          ) : result ? (
            <>
              {/* Option A */}
              <div className="flex min-w-0 flex-1 flex-col border-r border-border">
                <div className="flex items-center justify-between border-b border-border bg-accent/5 px-4 py-2">
                  <span className="text-[11px] font-medium text-accent">{result.optionA.label}</span>
                  <button
                    onClick={() => copy(result.optionA.content)}
                    className="text-[10px] text-fg-subtle hover:text-fg"
                  >
                    Copy
                  </button>
                </div>
                <pre className="flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-[12px] text-fg">
                  {result.optionA.content}
                </pre>
              </div>
              {/* Option B */}
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center justify-between border-b border-border bg-accent-2/5 px-4 py-2">
                  <span className="text-[11px] font-medium text-accent-2">{result.optionB.label}</span>
                  <button
                    onClick={() => copy(result.optionB.content)}
                    className="text-[10px] text-fg-subtle hover:text-fg"
                  >
                    Copy
                  </button>
                </div>
                <pre className="flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-[12px] text-fg">
                  {result.optionB.content}
                </pre>
              </div>
            </>
          ) : null}
        </div>

        <div className="border-t border-border px-5 py-3 text-[11px] text-fg-subtle">
          Same conversation, two different temperatures. Disagreements highlight genuinely uncertain areas.
        </div>
      </div>
    </div>
  );
}
