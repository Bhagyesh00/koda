'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Square, ClipboardList, Hammer } from 'lucide-react';
import { useChatStore } from '@/lib/store';
import { cn } from '@/lib/cn';
import type { SessionMode } from '@koda/shared';

interface Props {
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
}

export function Composer({ onSend, onStop, streaming, disabled }: Props) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const mode = useChatStore((s) => s.mode);
  const setMode = useChatStore((s) => s.setMode);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = 'auto';
    ref.current.style.height = Math.min(ref.current.scrollHeight, 200) + 'px';
  }, [text]);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || streaming || disabled) return;
    onSend(trimmed);
    setText('');
  }

  return (
    <div className="relative border-t border-border bg-bg/40 px-6 py-4">
      {/* Animated progress bar shown while the model is streaming */}
      {streaming && (
        <div className="absolute left-0 right-0 top-0 h-[2px] overflow-hidden">
          <div className="koda-progress h-full w-full" />
        </div>
      )}

      <div className="mx-auto max-w-3xl">
        <div className="koda-glass flex items-end gap-2 rounded-2xl p-2 shadow-glow shadow-accent-glow/20">
          <ModeToggle value={mode} onChange={setMode} disabled={streaming || disabled} />

          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              disabled
                ? 'Select or create a session…'
                : mode === 'plan'
                  ? 'Describe what you want planned…'
                  : 'Ask Koda to do something…'
            }
            rows={1}
            disabled={disabled}
            className="flex-1 resize-none bg-transparent px-2 py-1.5 text-[14px] text-fg outline-none placeholder:text-fg-subtle disabled:opacity-50"
          />

          {streaming ? (
            <button
              onClick={onStop}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-bg-hover text-fg transition hover:bg-bg-subtle"
              aria-label="Stop"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!text.trim() || disabled}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white shadow-glow shadow-accent-glow transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              aria-label="Send"
            >
              <Send size={14} />
            </button>
          )}
        </div>

        <div className="mt-2 text-center text-[11px] text-fg-subtle">
          {mode === 'plan'
            ? 'Plan mode — read-only exploration. Koda will draft a plan for your approval.'
            : 'Build mode — Koda can edit files and run commands. Risky actions need approval.'}
        </div>
      </div>
    </div>
  );
}

interface ModeToggleProps {
  value: SessionMode;
  onChange: (m: SessionMode) => void;
  disabled?: boolean;
}

function ModeToggle({ value, onChange, disabled }: ModeToggleProps) {
  return (
    <div
      className={cn(
        'flex items-center rounded-xl border border-border bg-bg-subtle/60 p-0.5',
        disabled && 'pointer-events-none opacity-60',
      )}
      role="tablist"
      aria-label="Mode"
    >
      <ModeButton
        active={value === 'plan'}
        onClick={() => onChange('plan')}
        icon={<ClipboardList size={12} />}
        label="Plan"
      />
      <ModeButton
        active={value === 'build'}
        onClick={() => onChange('build')}
        icon={<Hammer size={12} />}
        label="Build"
      />
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={cn(
        'flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium transition',
        active
          ? 'bg-accent text-white shadow-sm'
          : 'text-fg-muted hover:bg-bg-hover hover:text-fg',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
