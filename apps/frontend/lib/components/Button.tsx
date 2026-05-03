'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon rendered before the label. */
  leftIcon?: ReactNode;
  /** Icon rendered after the label. */
  rightIcon?: ReactNode;
  /** Replaces children with a spinner; respects size and disables clicks. */
  loading?: boolean;
  /** Full-width inside its parent flex/grid cell. */
  block?: boolean;
}

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent-hover ' +
    'shadow-sm shadow-accent/25 disabled:hover:bg-accent',
  secondary:
    'border border-border bg-bg-subtle text-fg hover:bg-bg-hover',
  ghost:
    'text-fg-muted hover:bg-bg-hover hover:text-fg',
  danger:
    'border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20',
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  sm: 'h-7  px-2.5 text-[11px] gap-1   rounded-md',
  md: 'h-8  px-3   text-[12px] gap-1.5 rounded-md',
  lg: 'h-10 px-4   text-[14px] gap-2   rounded-lg',
};

const SPINNER_SIZE: Record<ButtonSize, number> = { sm: 12, md: 14, lg: 16 };

/**
 * Standard button. Use this in place of `<button class="…">` everywhere.
 *
 * - Focus ring is inherited from globals.css; do NOT add `focus:outline-none`.
 * - For icon-only buttons, prefer `<IconButton>` (it enforces aria-label).
 * - `loading` prop swaps children for a spinner and disables the button.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    leftIcon,
    rightIcon,
    loading = false,
    block = false,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center font-medium transition-colors select-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 size={SPINNER_SIZE[size]} className="animate-spin" />
      ) : (
        <>
          {leftIcon}
          {children}
          {rightIcon}
        </>
      )}
    </button>
  );
});
