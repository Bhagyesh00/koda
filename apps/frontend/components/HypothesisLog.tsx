'use client';

import { FlaskConical, X, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useChatStore } from '@/lib/store';
import type { HypothesisEntry } from '@/lib/store';
import { cn } from '@/lib/cn';

interface Props {
  onClose: () => void;
}

const RESULT_CONFIG = {
  confirmed: {
    icon: CheckCircle2,
    color: 'text-green-400',
    bg: 'bg-green-400/10 border-green-400/30',
    label: 'Confirmed',
  },
  refuted: {
    icon: XCircle,
    color: 'text-red-400',
    bg: 'bg-red-400/10 border-red-400/30',
    label: 'Refuted',
  },
  pending: {
    icon: Clock,
    color: 'text-yellow-400',
    bg: 'bg-yellow-400/10 border-yellow-400/30',
    label: 'Pending',
  },
} as const;

export function HypothesisLog({ onClose }: Props) {
  const hypotheses = useChatStore((s) => s.hypotheses);

  const confirmed = hypotheses.filter((h) => h.result === 'confirmed').length;
  const refuted = hypotheses.filter((h) => h.result === 'refuted').length;
  const pending = hypotheses.filter((h) => h.result === 'pending').length;

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-l border-border bg-bg-panel/90 backdrop-blur">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <FlaskConical size={14} className="text-accent" />
          <span className="text-[13px] font-semibold text-fg">Hypothesis Engine</span>
          {hypotheses.length > 0 && (
            <span className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              {hypotheses.length}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-fg-subtle hover:text-fg"><X size={14} /></button>
      </div>

      {hypotheses.length > 0 && (
        <div className="flex gap-3 border-b border-border px-4 py-2 text-[11px]">
          <Stat label="Confirmed" value={confirmed} color="text-green-400" />
          <Stat label="Refuted" value={refuted} color="text-red-400" />
          <Stat label="Pending" value={pending} color="text-yellow-400" />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {hypotheses.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-fg-subtle">
            <FlaskConical size={28} className="mx-auto mb-3 opacity-20" />
            <p>No hypotheses recorded yet.</p>
            <p className="mt-1 text-[11px]">Koda will record predictions before making changes and verify them after.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {[...hypotheses].reverse().map((h) => (
              <HypothesisCard key={h.id} entry={h} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border px-3 py-2 text-[11px] text-fg-subtle">
        Tracks the agent's predictions and whether they held true.
      </div>
    </aside>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className={cn('text-[14px] font-semibold', color)}>{value}</span>
      <span className="text-fg-subtle">{label}</span>
    </div>
  );
}

function HypothesisCard({ entry }: { entry: HypothesisEntry }) {
  const cfg = RESULT_CONFIG[entry.result];
  const Icon = cfg.icon;

  return (
    <div className={cn('rounded-lg border p-3 text-[12px]', cfg.bg)}>
      <div className="flex items-start gap-2">
        <Icon size={13} className={cn('mt-0.5 shrink-0', cfg.color)} />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-fg">{entry.claim}</div>
          {entry.actualOutcome && (
            <div className="mt-1 rounded bg-bg/50 px-2 py-1 font-mono text-[10px] text-fg-muted">
              {entry.actualOutcome}
            </div>
          )}
        </div>
        <span className={cn('shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium', cfg.bg, cfg.color)}>
          {cfg.label}
        </span>
      </div>
    </div>
  );
}
