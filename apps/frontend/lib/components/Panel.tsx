'use client';

import { type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './IconButton';

export interface PanelProps {
  /** Header title — usually a single line of text or label + badge group. */
  title: ReactNode;
  /** Optional left-side icon shown next to the title (16-20 px). */
  icon?: ReactNode;
  /** Optional badge area shown right of the title, before the actions. */
  badge?: ReactNode;
  /** Action buttons rendered before the close button (e.g. refresh, settings). */
  actions?: ReactNode;
  /** Footer slot — typically primary CTA + secondary controls. */
  footer?: ReactNode;
  /** Body content (scrollable). */
  children: ReactNode;
  /** Called when the user clicks the × icon or presses Escape. Optional. */
  onClose?: () => void;
  /** ARIA label for the close button — required when onClose is set. */
  closeLabel?: string;
  /** When true, the panel takes full mobile width and slides in from the right on desktop. */
  className?: string;
  /**
   * Whether the panel is fixed-width on desktop or full-width. Defaults to a
   * desktop-friendly 380 px on md+, full width below that for mobile use.
   */
  width?: 'auto' | 'narrow' | 'wide';
}

const WIDTH: Record<NonNullable<PanelProps['width']>, string> = {
  auto:   'w-full',
  narrow: 'w-full md:w-[340px]',
  wide:   'w-full md:w-[420px]',
};

/**
 * Side-panel shell. Standardises the header/body/footer layout used by every
 * panel in the app (Guardrails, Snapshots, Regret, MentalModel, …) so close
 * buttons, dividers, and scroll containers stay consistent.
 *
 * Accepts an `onClose` handler — if set, an × icon is rendered with the
 * provided `closeLabel` for accessibility.
 */
export function Panel({
  title,
  icon,
  badge,
  actions,
  footer,
  children,
  onClose,
  closeLabel,
  width = 'narrow',
  className,
}: PanelProps) {
  if (onClose && !closeLabel) {
    // Fail loudly in dev so we don't ship inaccessible × icons.
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[Panel] onClose was set without closeLabel — screen-reader users will hear "button" with no context.');
    }
  }

  return (
    <aside
      role="complementary"
      className={cn(
        'flex h-full shrink-0 flex-col border-l border-border bg-bg-panel/90 backdrop-blur',
        WIDTH[width],
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {icon && <span className="shrink-0 text-accent-2">{icon}</span>}
          <span className="truncate text-[13px] font-semibold text-fg">{title}</span>
          {badge}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {onClose && (
            <IconButton
              size="xs"
              icon={<X />}
              aria-label={closeLabel ?? 'Close panel'}
              onClick={onClose}
            />
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {children}
      </div>

      {footer && (
        <footer className="border-t border-border p-3">
          {footer}
        </footer>
      )}
    </aside>
  );
}
