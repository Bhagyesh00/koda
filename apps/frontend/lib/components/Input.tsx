'use client';

import { forwardRef, useId, type InputHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

// ── Field wrapper (label + hint + error) ─────────────────────────────────────

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Renders an asterisk after the label. */
  required?: boolean;
  /** Pass through the input/textarea id so the label points at the right element. */
  htmlFor: string;
  children: ReactNode;
  className?: string;
}

export function Field({ label, hint, error, required, htmlFor, children, className }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-[11px] font-medium text-fg-muted">
          {label}
          {required && <span aria-hidden className="ml-0.5 text-red-400">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p role="alert" className="text-[11px] text-red-400">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

// ── Input ────────────────────────────────────────────────────────────────────

const INPUT_BASE =
  'w-full rounded-md border bg-bg px-2.5 py-1.5 text-[12px] text-fg placeholder:text-fg-subtle ' +
  'transition-colors disabled:cursor-not-allowed disabled:opacity-50';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Render the input with a monospace font (regex/path inputs). */
  mono?: boolean;
  /**
   * Skip the label/hint/error wrapper and render the bare input element.
   * Use this when the field is already inside a custom layout. Note: avoid
   * the name `wrap` — `<textarea wrap="soft|hard">` is a real HTML attribute.
   */
  bare?: boolean;
}

/** Standard text input. Wraps with label/hint/error when any are provided. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, mono, bare = false, className, id, required, ...rest },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? reactId;
  const errorId = error ? `${inputId}-error` : undefined;

  const input = (
    <input
      id={inputId}
      ref={ref}
      required={required}
      aria-invalid={error ? true : undefined}
      aria-describedby={errorId}
      className={cn(
        INPUT_BASE,
        error ? 'border-red-500/50 focus:border-red-400' : 'border-border focus:border-accent',
        mono && 'font-mono',
        className,
      )}
      {...rest}
    />
  );

  if (bare || (!label && !hint && !error)) return input;
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={inputId}>
      {input}
    </Field>
  );
});

// ── Textarea ─────────────────────────────────────────────────────────────────

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  mono?: boolean;
  /** See Input.bare — same semantics. Native `wrap` attribute remains available. */
  bare?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, mono, bare = false, className, id, required, rows = 3, ...rest },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? reactId;
  const errorId = error ? `${inputId}-error` : undefined;

  const ta = (
    <textarea
      id={inputId}
      ref={ref}
      rows={rows}
      required={required}
      aria-invalid={error ? true : undefined}
      aria-describedby={errorId}
      className={cn(
        INPUT_BASE,
        'resize-y',
        error ? 'border-red-500/50 focus:border-red-400' : 'border-border focus:border-accent',
        mono && 'font-mono',
        className,
      )}
      {...rest}
    />
  );

  if (bare || (!label && !hint && !error)) return ta;
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={inputId}>
      {ta}
    </Field>
  );
});
