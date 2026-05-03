'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type IconButtonSize = 'xs' | 'sm' | 'md';
export type IconButtonTone = 'neutral' | 'danger';

/**
 * Icon-only button. `aria-label` is REQUIRED at the type level — without it,
 * screen-reader users have no idea what the button does.
 *
 * Use `pressed` for toggle buttons (it sets `aria-pressed` and styles the
 * active state). Pair with `count` to render a small numeric badge in the
 * top-right corner (notification dots, pending counts, etc).
 */
export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  icon: ReactNode;
  /** Required — what the button does, said out loud. */
  'aria-label': string;
  size?: IconButtonSize;
  tone?: IconButtonTone;
  /** Toggle-state: when true, renders the active styling and sets aria-pressed. */
  pressed?: boolean;
  /** Optional small badge (count or dot) — pass undefined / 0 to hide. */
  count?: number | string;
  /** Color for the badge text — defaults to accent. */
  countTone?: 'accent' | 'warn' | 'danger';
}

const SIZE: Record<IconButtonSize, { box: string; iconSize: number }> = {
  xs: { box: 'h-6 w-6 rounded',    iconSize: 12 },
  sm: { box: 'h-7 w-7 rounded-md', iconSize: 14 },
  md: { box: 'h-8 w-8 rounded-md', iconSize: 16 },
};

const COUNT_TONE = {
  accent: 'text-accent',
  warn:   'text-yellow-400',
  danger: 'text-red-400',
} as const;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    size = 'sm',
    tone = 'neutral',
    pressed = false,
    count,
    countTone = 'accent',
    className,
    type = 'button',
    title,
    'aria-label': ariaLabel,
    ...rest
  },
  ref,
) {
  const { box, iconSize } = SIZE[size];
  const showCount = count !== undefined && count !== 0 && count !== '';

  const cloneIcon =
    icon && typeof icon === 'object' && 'props' in (icon as object)
      ? (icon as { props: { size?: number } })
      : null;
  const renderedIcon = cloneIcon?.props.size === undefined
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ ...(icon as any), props: { ...(cloneIcon?.props ?? {}), size: iconSize } } as ReactNode)
    : icon;

  return (
    <button
      ref={ref}
      type={type}
      aria-label={ariaLabel}
      aria-pressed={pressed || undefined}
      title={title ?? ariaLabel}
      className={cn(
        'relative inline-flex items-center justify-center transition-colors select-none',
        box,
        pressed
          ? tone === 'danger'
            ? 'bg-red-500/15 text-red-400'
            : 'bg-accent/20 text-accent'
          : tone === 'danger'
            ? 'text-fg-subtle hover:bg-red-500/10 hover:text-red-400'
            : 'text-fg-subtle hover:bg-bg-hover hover:text-fg',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      {renderedIcon}
      {showCount && (
        <span
          className={cn(
            'absolute -top-0.5 -right-0.5 min-w-[14px] rounded-full bg-bg-panel px-1 text-[9px] font-semibold leading-[14px] tabular-nums',
            COUNT_TONE[countTone],
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
});
