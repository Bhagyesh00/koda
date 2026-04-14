'use client';

import { useState } from 'react';
import { Brain, RotateCcw, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

/* ── Types ─────────────────────────────────────────────────── */
interface Props {
  phase: 'diagnosing' | 'retrying' | 'resolved' | 'exhausted';
  currentAttempt: number;
  maxAttempts: number;
  attempts?: Array<{ error: string }>;
}

/* ── Phase visual config ───────────────────────────────────── */
const PHASE_CONFIG = {
  diagnosing: {
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/40',
    text: 'text-yellow-400',
    glowColor: 'rgba(234, 179, 8, 0.15)',
  },
  retrying: {
    bg: 'bg-sky-500/10',
    border: 'border-sky-500/40',
    text: 'text-sky-400',
    glowColor: 'rgba(14, 165, 233, 0.15)',
  },
  resolved: {
    bg: 'bg-green-500/10',
    border: 'border-green-500/40',
    text: 'text-green-400',
    glowColor: 'rgba(34, 197, 94, 0.15)',
  },
  exhausted: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/40',
    text: 'text-red-400',
    glowColor: 'rgba(239, 68, 68, 0.15)',
  },
} as const;

/* ── Component ─────────────────────────────────────────────── */
export function ErrorResolutionBadge({ phase, currentAttempt, maxAttempts, attempts }: Props) {
  const [showAttempts, setShowAttempts] = useState(false);
  const config = PHASE_CONFIG[phase];

  const previousAttempts = attempts?.slice(0, -1) ?? [];
  const hasPrevious = previousAttempts.length > 0;

  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2 transition-all duration-300',
        config.bg,
        config.border,
      )}
      style={
        phase === 'resolved'
          ? { boxShadow: `0 0 20px -4px ${config.glowColor}` }
          : undefined
      }
    >
      {/* Main status row */}
      <div className="flex items-center gap-2">
        {/* Icon */}
        {phase === 'diagnosing' && (
          <div className="relative flex items-center justify-center">
            <Brain size={14} className={cn(config.text, 'animate-pulseDot')} />
          </div>
        )}
        {phase === 'retrying' && (
          <RotateCcw size={14} className={cn(config.text, 'animate-spin')} style={{ animationDuration: '1.2s' }} />
        )}
        {phase === 'resolved' && (
          <CheckCircle2 size={14} className={config.text} />
        )}
        {phase === 'exhausted' && (
          <AlertTriangle size={14} className={config.text} />
        )}

        {/* Label */}
        <span className={cn('text-[12px] font-medium', config.text)}>
          {phase === 'diagnosing' &&
            `Diagnosing failure (attempt ${currentAttempt}/${maxAttempts})...`}
          {phase === 'retrying' && 'Retrying with different approach...'}
          {phase === 'resolved' &&
            `Resolved after ${currentAttempt} attempt${currentAttempt !== 1 ? 's' : ''}`}
          {phase === 'exhausted' &&
            `Failed after ${maxAttempts} attempts`}
        </span>

        {/* Previous attempts toggle */}
        {hasPrevious && (
          <button
            onClick={() => setShowAttempts((v) => !v)}
            className={cn(
              'ml-auto flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] transition',
              'text-fg-subtle hover:bg-bg-hover hover:text-fg',
            )}
          >
            {showAttempts ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            {previousAttempts.length} prior
          </button>
        )}
      </div>

      {/* Shimmer progress bar (diagnosing + retrying only) */}
      {(phase === 'diagnosing' || phase === 'retrying') && (
        <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-bg-hover">
          <div
            className="h-full w-full rounded-full koda-shimmer"
            style={{
              background:
                phase === 'diagnosing'
                  ? 'linear-gradient(90deg, rgba(234,179,8,0.15) 0%, rgba(234,179,8,0.5) 50%, rgba(234,179,8,0.15) 100%)'
                  : 'linear-gradient(90deg, rgba(14,165,233,0.15) 0%, rgba(14,165,233,0.5) 50%, rgba(14,165,233,0.15) 100%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.6s linear infinite',
            }}
          />
        </div>
      )}

      {/* Collapsed previous attempt chips */}
      {showAttempts && hasPrevious && (
        <div className="mt-2 space-y-1">
          {previousAttempts.map((attempt, i) => (
            <div
              key={i}
              className="flex items-start gap-1.5 rounded bg-bg-subtle/50 px-2 py-1 text-[10px] text-fg-subtle"
            >
              <span className="shrink-0 font-mono text-fg-muted">#{i + 1}</span>
              <span className="line-clamp-2 break-all">{attempt.error}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
