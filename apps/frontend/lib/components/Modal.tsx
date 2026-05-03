'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './IconButton';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Footer slot — typically primary CTA + Cancel. */
  footer?: ReactNode;
  size?: ModalSize;
  /** Hide the title bar entirely (for fully custom layouts). */
  bare?: boolean;
  /** When true, disables the backdrop-click-to-close behaviour. */
  staticBackdrop?: boolean;
  children: ReactNode;
}

/**
 * Accessible modal dialog. Renders into a portal so it escapes overflow:hidden
 * containers. Closes on Escape and (by default) on backdrop click. Restores
 * focus to the previously-focused element on close.
 *
 * Note: this is intentionally not a fully focus-trapped dialog — Tab can leave
 * the modal. Add `inert` attributes on background content if you need strict
 * containment for very long-form modals.
 */
export function Modal({
  open,
  onClose,
  title,
  footer,
  size = 'md',
  bare = false,
  staticBackdrop = false,
  children,
}: ModalProps) {
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Track the element that opened the modal so we can restore focus on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    // Move focus into the dialog so keyboard users start there.
    queueMicrotask(() => dialogRef.current?.focus());
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // Escape closes; mounted on window so it works even when focus is outside the dialog.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === 'undefined') return null; // SSR safety

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fadeInUp"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !staticBackdrop) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={bare ? undefined : 'modal-title'}
        tabIndex={-1}
        className={cn(
          'flex max-h-[85vh] w-full flex-col overflow-hidden rounded-xl border border-border bg-bg-panel shadow-2xl',
          SIZE[size],
        )}
      >
        {!bare && (
          <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
            <h2 id="modal-title" className="truncate text-[14px] font-semibold text-fg">
              {title}
            </h2>
            <IconButton
              size="sm"
              icon={<X />}
              aria-label="Close dialog"
              onClick={onClose}
            />
          </header>
        )}
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
