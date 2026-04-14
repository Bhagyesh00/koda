'use client';

import { useState } from 'react';
import { GitBranch, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { resolveDecision } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { DecisionOption } from '@/lib/store';

interface Props {
  callId: string;
  question: string;
  options: DecisionOption[];
  resolved: boolean;
  chosenIndex?: number;
  onResolve: (callId: string, optionIndex: number) => void;
}

export function DecisionCard({ callId, question, options, resolved, chosenIndex, onResolve }: Props) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleChoose(idx: number) {
    if (resolved || submitting) return;
    setSubmitting(true);
    try {
      await resolveDecision(callId, idx);
      onResolve(callId, idx);
    } catch {
      /* ignore — SSE will recover */
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-6 my-3 rounded-xl border border-accent/30 bg-bg-panel/80 p-4 backdrop-blur">
      <div className="mb-3 flex items-start gap-2">
        <GitBranch size={14} className="mt-0.5 shrink-0 text-accent" />
        <div>
          <div className="text-[12px] font-semibold text-fg-subtle uppercase tracking-wider mb-0.5">
            Decision required
          </div>
          <p className="text-[14px] font-medium text-fg">{question}</p>
        </div>
      </div>

      <div className="space-y-2">
        {options.map((opt, idx) => {
          const isChosen = resolved && chosenIndex === idx;
          const isExpanded = expandedIdx === idx;

          return (
            <div
              key={idx}
              className={cn(
                'rounded-lg border transition-all',
                isChosen
                  ? 'border-accent/60 bg-accent/10'
                  : resolved
                  ? 'border-border/40 bg-bg opacity-50'
                  : 'border-border bg-bg-subtle hover:border-accent/40',
              )}
            >
              <div className="flex items-center gap-2 px-3 py-2">
                {isChosen && <CheckCircle2 size={13} className="shrink-0 text-accent" />}
                {!isChosen && (
                  <div className="h-4 w-4 shrink-0 flex items-center justify-center rounded-full border border-border text-[10px] text-fg-subtle">
                    {idx + 1}
                  </div>
                )}
                <span className={cn('flex-1 text-[13px] font-medium', isChosen ? 'text-fg' : 'text-fg-subtle')}>
                  {opt.label}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                    className="text-fg-subtle hover:text-fg"
                    aria-label={isExpanded ? 'Collapse' : 'Expand details'}
                  >
                    {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                  {!resolved && (
                    <button
                      onClick={() => void handleChoose(idx)}
                      disabled={submitting}
                      className="rounded bg-accent px-2.5 py-0.5 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition"
                    >
                      Choose
                    </button>
                  )}
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-border/40 px-3 py-2 grid grid-cols-2 gap-3 text-[11px]">
                  {opt.pros.length > 0 && (
                    <div>
                      <div className="mb-1 font-medium text-green-400">Pros</div>
                      <ul className="space-y-0.5 text-fg-subtle">
                        {opt.pros.map((p, i) => <li key={i}>+ {p}</li>)}
                      </ul>
                    </div>
                  )}
                  {opt.cons.length > 0 && (
                    <div>
                      <div className="mb-1 font-medium text-red-400">Cons</div>
                      <ul className="space-y-0.5 text-fg-subtle">
                        {opt.cons.map((c, i) => <li key={i}>- {c}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
