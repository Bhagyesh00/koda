'use client';

import { ClipboardList, Hammer } from 'lucide-react';
import type { SessionMode } from '@koda/shared';
import { cn } from '@/lib/cn';

interface Props {
  mode: SessionMode;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Compact pill that visually indicates the current session mode.
 * Plan mode = read-only planning, Build mode = full tool access.
 */
export function ModePill({ mode, size = 'sm', className }: Props) {
  const isPlan = mode === 'plan';
  const Icon = isPlan ? ClipboardList : Hammer;
  const label = isPlan ? 'Plan' : 'Build';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-[10.5px]' : 'px-2.5 py-1 text-[12px]',
        isPlan
          ? 'border-accent-2/40 bg-accent-2/10 text-accent-2'
          : 'border-accent/40 bg-accent/10 text-accent',
        className,
      )}
      aria-label={`${label} mode`}
    >
      <Icon size={size === 'sm' ? 11 : 13} />
      {label}
    </span>
  );
}
