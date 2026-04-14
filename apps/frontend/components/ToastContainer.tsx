'use client';

import { useEffect } from 'react';
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { useChatStore, type Toast } from '@/lib/store';
import { cn } from '@/lib/cn';

const AUTO_DISMISS_MS = 3000;

export function ToastContainer() {
  const toasts = useChatStore((s) => s.toasts);
  const removeToast = useChatStore((s) => s.removeToast);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const Icon =
    toast.variant === 'error'
      ? AlertCircle
      : toast.variant === 'success'
        ? CheckCircle2
        : Info;

  return (
    <div
      className={cn(
        'pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[12px] shadow-lg',
        toast.variant === 'error'
          ? 'border-red-500/40 bg-bg-panel text-red-300'
          : toast.variant === 'success'
            ? 'border-green-500/30 bg-bg-panel text-green-300'
            : 'border-border bg-bg-panel text-fg',
      )}
    >
      <Icon size={13} className="mt-0.5 shrink-0" />
      <span className="flex-1">{toast.message}</span>
      <button onClick={onDismiss} className="ml-1 shrink-0 text-fg-subtle hover:text-fg">
        <X size={12} />
      </button>
    </div>
  );
}
