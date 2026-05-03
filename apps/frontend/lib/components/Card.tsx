'use client';

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type CardTone = 'default' | 'subtle' | 'accent' | 'danger' | 'warn';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

const TONE: Record<CardTone, string> = {
  default: 'border-border bg-bg-subtle',
  subtle:  'border-border/60 bg-bg/50',
  accent:  'border-accent/30 bg-accent/5',
  danger:  'border-red-500/40 bg-red-500/5',
  warn:    'border-yellow-500/40 bg-yellow-500/5',
};

const PADDING: Record<CardPadding, string> = {
  none: '',
  sm:   'p-2',
  md:   'p-3',
  lg:   'p-4',
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: CardTone;
  padding?: CardPadding;
  /** When true, hover state lifts/borders subtly (use for clickable cards). */
  interactive?: boolean;
  /** When true, dim the card (typical "disabled rule" pattern). */
  muted?: boolean;
  children?: ReactNode;
}

/**
 * Surface primitive. Replaces hand-rolled `border bg-bg-subtle rounded-lg p-3`
 * patterns so tone/padding stay consistent across panels.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { tone = 'default', padding = 'md', interactive = false, muted = false, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border transition-colors',
        TONE[tone],
        PADDING[padding],
        interactive && 'cursor-pointer hover:bg-bg-hover',
        muted && 'opacity-60',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});
