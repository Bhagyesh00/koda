'use client';

import { useMemo, useState } from 'react';
import {
  ChevronRight,
  Wrench,
  Check,
  X,
  Loader2,
  AlertCircle,
  FileText,
  Pencil,
  FilePlus2,
  Search,
  Folder,
  Terminal,
  ListChecks,
  ClipboardList,
} from 'lucide-react';
import { createPatch } from 'diff';
import { cn } from '@/lib/cn';
import { approve } from '@/lib/api';
import { useChatStore } from '@/lib/store';

interface Props {
  callId: string;
  tool: string;
  args: unknown;
  requiresApproval: boolean;
  status: 'pending' | 'approved' | 'denied' | 'completed' | 'error';
  output?: string;
}

type ToolFamily = 'read' | 'write' | 'run' | 'meta';

export function ToolCallCard({ callId, tool, args, requiresApproval, status, output }: Props) {
  const [open, setOpen] = useState(status === 'pending');
  const setStatus = useChatStore((s) => s.setToolStatus);

  async function handleApprove() {
    setStatus(callId, 'approved');
    await approve(callId, { action: 'approve' });
  }

  async function handleDeny() {
    setStatus(callId, 'denied');
    await approve(callId, { action: 'deny' });
  }

  const family = familyFor(tool);
  const ToolIcon = iconFor(tool);
  const summary = useMemo(() => summarize(tool, args), [tool, args]);

  return (
    <div
      className={cn(
        'mx-6 my-2 flex overflow-hidden rounded-lg border border-border bg-bg-panel transition',
        status === 'pending' && requiresApproval && 'ring-1 ring-yellow-500/30',
      )}
    >
      {/* Left family bar */}
      <div className={cn('w-[3px] shrink-0', familyBar(family))} />

      <div className="min-w-0 flex-1">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-bg-subtle"
        >
          <ChevronRight
            size={14}
            className={cn('shrink-0 text-fg-subtle transition', open && 'rotate-90')}
          />
          <ToolIcon size={13} className={familyText(family)} />
          <span className="font-mono text-fg">{tool}</span>
          <span className="truncate font-mono text-fg-subtle">{summary}</span>
          <StatusIcon status={status} requiresApproval={requiresApproval} />
        </button>

        {open && (
          <div className="border-t border-border px-3 py-2">
            <ToolPreview tool={tool} args={args} />

            {status === 'pending' && requiresApproval && (
              <div className="mt-2 flex gap-2">
                <button
                  onClick={handleApprove}
                  className="flex items-center gap-1 rounded bg-accent px-3 py-1 text-[12px] font-medium text-white shadow-glow shadow-accent-glow transition hover:bg-accent-hover"
                >
                  <Check size={12} /> Approve
                </button>
                <button
                  onClick={handleDeny}
                  className="flex items-center gap-1 rounded border border-border px-3 py-1 text-[12px] font-medium text-fg-muted hover:bg-bg-hover"
                >
                  <X size={12} /> Deny
                </button>
              </div>
            )}

            {output != null && (
              <div className="mt-2">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-fg-subtle">
                  output
                </div>
                <pre className="max-h-80 overflow-auto rounded border border-border bg-bg p-2 text-[12px] text-fg">
                  {output}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

function StatusIcon({
  status,
  requiresApproval,
}: {
  status: Props['status'];
  requiresApproval: boolean;
}) {
  if (status === 'pending' && requiresApproval)
    return <AlertCircle size={13} className="ml-auto shrink-0 text-yellow-400" />;
  if (status === 'approved')
    return <Loader2 size={13} className="ml-auto shrink-0 animate-spin text-fg-muted" />;
  if (status === 'completed')
    return <Check size={13} className="ml-auto shrink-0 text-green-400" />;
  if (status === 'denied') return <X size={13} className="ml-auto shrink-0 text-fg-muted" />;
  if (status === 'error')
    return <AlertCircle size={13} className="ml-auto shrink-0 text-red-400" />;
  return <Wrench size={13} className="ml-auto shrink-0 text-fg-muted" />;
}

function familyFor(tool: string): ToolFamily {
  if (tool === 'write_file' || tool === 'edit_file') return 'write';
  if (tool === 'bash') return 'run';
  if (tool === 'todo_write' || tool === 'plan_write') return 'meta';
  return 'read';
}

function familyBar(f: ToolFamily): string {
  switch (f) {
    case 'write':
      return 'bg-accent';
    case 'run':
      return 'bg-yellow-500/70';
    case 'meta':
      return 'bg-accent-2';
    case 'read':
    default:
      return 'bg-sky-500/60';
  }
}

function familyText(f: ToolFamily): string {
  switch (f) {
    case 'write':
      return 'text-accent';
    case 'run':
      return 'text-yellow-400';
    case 'meta':
      return 'text-accent-2';
    case 'read':
    default:
      return 'text-sky-400';
  }
}

function iconFor(tool: string) {
  switch (tool) {
    case 'read_file':
      return FileText;
    case 'write_file':
      return FilePlus2;
    case 'edit_file':
      return Pencil;
    case 'glob':
      return Search;
    case 'grep':
      return Search;
    case 'list_dir':
      return Folder;
    case 'bash':
      return Terminal;
    case 'todo_write':
      return ListChecks;
    case 'plan_write':
      return ClipboardList;
    default:
      return Wrench;
  }
}

function summarize(tool: string, args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const a = args as Record<string, unknown>;
  switch (tool) {
    case 'read_file':
    case 'list_dir':
      return str(a.path);
    case 'write_file':
    case 'edit_file':
      return str(a.path);
    case 'glob':
      return str(a.pattern);
    case 'grep':
      return `"${str(a.pattern)}"${a.path ? ` in ${str(a.path)}` : ''}`;
    case 'bash':
      return truncate(str(a.command), 80);
    case 'todo_write':
      return Array.isArray(a.todos) ? `${a.todos.length} todos` : '';
    case 'plan_write':
      return 'drafting plan…';
    default: {
      const first = Object.entries(a)[0];
      if (!first) return '';
      const [k, v] = first;
      return `${k}: ${truncate(typeof v === 'string' ? v : JSON.stringify(v), 60)}`;
    }
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/* ---------- per-tool preview body ---------- */

function ToolPreview({ tool, args }: { tool: string; args: unknown }) {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;

  if (tool === 'edit_file') {
    const path = str(a.path) || 'file';
    const oldStr = str(a.oldString);
    const newStr = str(a.newString);
    const patch = createPatch(path, oldStr, newStr, '', '', { context: 2 });
    return <DiffBlock patch={patch} />;
  }

  if (tool === 'write_file') {
    const content = str(a.content);
    return (
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-fg-subtle">
          new content ({content.length} bytes)
        </div>
        <pre className="max-h-72 overflow-auto rounded border border-border bg-bg p-2 text-[12px] text-fg">
          {content}
        </pre>
      </div>
    );
  }

  if (tool === 'bash') {
    return (
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-fg-subtle">command</div>
        <pre className="overflow-x-auto rounded border border-border bg-bg p-2 text-[12px] text-fg">
          $ {str(a.command)}
        </pre>
      </div>
    );
  }

  if (tool === 'plan_write') {
    const content = str(a.content);
    return (
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-fg-subtle">plan</div>
        <pre className="max-h-72 overflow-auto rounded border border-border bg-bg p-2 text-[12px] text-fg">
          {content}
        </pre>
      </div>
    );
  }

  // generic JSON view
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wide text-fg-subtle">args</div>
      <pre className="overflow-x-auto rounded border border-border bg-bg p-2 text-[12px] text-fg">
        {JSON.stringify(args, null, 2)}
      </pre>
    </div>
  );
}

function DiffBlock({ patch }: { patch: string }) {
  const lines = patch.split('\n').slice(4); // drop header
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wide text-fg-subtle">diff</div>
      <pre className="max-h-72 overflow-auto rounded border border-border bg-bg p-2 font-mono text-[12px] leading-snug">
        {lines.map((line, i) => {
          let cls = 'text-fg';
          if (line.startsWith('+') && !line.startsWith('+++'))
            cls = 'bg-green-500/10 text-green-300';
          else if (line.startsWith('-') && !line.startsWith('---'))
            cls = 'bg-red-500/10 text-red-300';
          else if (line.startsWith('@@')) cls = 'text-accent-2';
          return (
            <div key={i} className={cls}>
              {line || ' '}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
