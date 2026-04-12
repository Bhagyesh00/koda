'use client';

import { Circle, CircleDot, CheckCircle2 } from 'lucide-react';
import type { Todo } from '@koda/shared';
import { cn } from '@/lib/cn';

export function TodoPanel({ todos }: { todos: Todo[] }) {
  if (todos.length === 0) return null;

  const total = todos.length;
  const done = todos.filter((t) => t.status === 'completed').length;

  return (
    <div className="border-b border-border bg-bg-panel/60 px-6 py-3 backdrop-blur">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
            Todos
          </div>
          <div className="text-[11px] tabular-nums text-fg-subtle">
            {done} / {total}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {todos.map((t) => (
            <TodoPill key={t.id} todo={t} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TodoPill({ todo }: { todo: Todo }) {
  const Icon =
    todo.status === 'completed'
      ? CheckCircle2
      : todo.status === 'in_progress'
        ? CircleDot
        : Circle;

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition',
        todo.status === 'completed' &&
          'border-green-500/30 bg-green-500/10 text-green-300/80 line-through',
        todo.status === 'in_progress' &&
          'border-accent/40 bg-accent/10 text-accent shadow-glow shadow-accent-glow/30',
        todo.status === 'pending' && 'border-border bg-bg-subtle text-fg-muted',
      )}
    >
      <Icon size={11} className="shrink-0" />
      <span className="truncate">{todo.content}</span>
    </span>
  );
}
