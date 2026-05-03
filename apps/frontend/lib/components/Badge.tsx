'use client';

import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'info';
export type BadgeSize = 'xs' | 'sm';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-bg-hover  text-fg-muted',
  accent:  'bg-accent/20 text-accent',
  success: 'bg-green-500/15  text-green-400',
  warn:    'bg-yellow-500/15 text-yellow-400',
  danger:  'bg-red-500/15    text-red-400',
  info:    'bg-blue-500/15   text-blue-400',
};

const SIZE: Record<BadgeSize, string> = {
  xs: 'px-1.5 py-0.5 text-[10px]',
  sm: 'px-2 py-0.5 text-[11px]',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
  /** Optional left-side icon (lucide icon, sized 10-12 px). */
  icon?: ReactNode;
  children: ReactNode;
}

/** Status / count pill. Replaces hand-rolled `rounded-full bg-* px-* text-[10px]` patterns. */
export function Badge({ tone = 'neutral', size = 'xs', icon, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium',
        TONE[tone],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}
