'use client';

import { useMemo, useState } from 'react';
import {
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
  GitCompare,
  Zap,
  ShieldCheck,
  ShieldX,
  Rewind,
  Globe,
  SearchCheck,
  GitBranch,
  CheckCircle2,
  XCircle,
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
  onReplay?: (callId: string, originalOutput: string) => void;
}

type ToolFamily = 'read' | 'write' | 'run' | 'meta';

const PREVIEW_LINES = 4;

export function ToolCallCard({
  callId,
  tool,
  args,
  requiresApproval,
  status,
  output,
  onReplay,
}: Props) {
  const [expandedOutput, setExpandedOutput] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const setStatus = useChatStore((s) => s.setToolStatus);
  const semanticDiffs = useChatStore((s) => s.semanticDiffs);
  const blastRadius = useChatStore((s) => s.blastRadius[callId]);
  const proofResult = useChatStore((s) => s.proofResults[callId]);
  const testResult = useChatStore((s) => s.testResults[callId]);

  const callPath = (args as { path?: string } | null)?.path;
  const semanticDiff = callPath ? semanticDiffs[callPath] : undefined;

  const family = familyFor(tool);
  const ToolIcon = iconFor(tool);
  const verb = verbFor(tool);
  const chip = useMemo(() => chipFor(tool, args), [tool, args]);

  async function handleApprove() {
    setStatus(callId, 'approved');
    await approve(callId, { action: 'approve' });
  }

  async function handleDeny() {
    setStatus(callId, 'denied');
    await approve(callId, { action: 'deny' });
  }

  // Output rendering: split into lines, show preview unless expanded
  const outputLines = output ? output.split('\n') : [];
  const isLong = outputLines.length > PREVIEW_LINES;
  const visibleLines = expandedOutput ? outputLines : outputLines.slice(0, PREVIEW_LINES);
  const hiddenCount = outputLines.length - PREVIEW_LINES;

  return (
    <div className="mx-6 my-1 flex gap-3 text-[12.5px]">
      {/* Tree-line indent */}
      <div className={cn('w-[2px] shrink-0 rounded-full', familyBar(family))} />

      <div className="min-w-0 flex-1 py-0.5">
        {/* Header line: icon + verb + chip + status */}
        <div className="flex items-center gap-2">
          <ToolIcon size={12} className={cn('shrink-0', familyText(family))} />
          <span className={cn('font-medium', familyText(family))}>{verb}</span>
          {chip && (
            <code className="min-w-0 truncate rounded bg-bg-subtle/60 px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">
              {chip}
            </code>
          )}
          <StatusIcon status={status} requiresApproval={requiresApproval} />

          {/* Inline approval buttons */}
          {status === 'pending' && requiresApproval && (
            <div className="ml-auto flex shrink-0 gap-1">
              <button
                onClick={handleApprove}
                className="flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-[10px] font-medium text-white hover:bg-accent-hover transition"
                title="Approve"
              >
                <Check size={9} /> Approve
              </button>
              <button
                onClick={handleDeny}
                className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] font-medium text-fg-muted hover:bg-bg-hover transition"
                title="Deny"
              >
                <X size={9} /> Deny
              </button>
            </div>
          )}
        </div>

        {/* Diff preview button for write/edit (small inline link) */}
        {(tool === 'edit_file' || tool === 'write_file') && status === 'pending' && requiresApproval && (
          <button
            onClick={() => setShowDiff((v) => !v)}
            className="mt-1 text-[10px] text-fg-subtle hover:text-fg"
          >
            {showDiff ? 'Hide diff' : 'Show diff'}
          </button>
        )}

        {showDiff && tool === 'edit_file' && (
          <DiffPreview
            path={(args as { path?: string }).path ?? 'file'}
            oldStr={(args as { oldString?: string }).oldString ?? ''}
            newStr={(args as { newString?: string }).newString ?? ''}
          />
        )}
        {showDiff && tool === 'write_file' && (
          <pre className="mt-1 max-h-72 overflow-auto rounded border border-border bg-bg p-2 text-[11px] text-fg-muted">
            {String((args as { content?: string }).content ?? '')}
          </pre>
        )}

        {/* Output preview — flat text under the header line */}
        {output != null && status !== 'pending' && (
          <div className="mt-0.5">
            <pre className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-snug text-fg-subtle">
              {visibleLines.join('\n')}
            </pre>
            {isLong && (
              <button
                onClick={() => setExpandedOutput((v) => !v)}
                className="mt-0.5 text-[10.5px] text-fg-subtle hover:text-fg"
              >
                {expandedOutput ? 'Hide' : `Show ${hiddenCount} more line${hiddenCount === 1 ? '' : 's'}`}
              </button>
            )}
            {onReplay && (status === 'completed' || status === 'error') && (
              <button
                onClick={() => onReplay(callId, output)}
                title="Counterfactual replay"
                className="ml-3 inline-flex items-center gap-1 text-[10px] text-fg-subtle hover:text-accent-2"
              >
                <Rewind size={9} /> Replay
              </button>
            )}
          </div>
        )}

        {/* Phase badges (blast radius, semantic diff, proof) — compact, inline */}
        {blastRadius && (
          <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-sky-300">
            <Zap size={10} />
            <span>
              Blast: {blastRadius.importers.length} importers · {blastRadius.references} refs · {blastRadius.tests.length} tests
            </span>
          </div>
        )}
        {semanticDiff && (
          <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-accent">
            <GitCompare size={10} />
            <span>{semanticDiff.summary}</span>
            <span className="text-fg-subtle">
              (+{semanticDiff.added} −{semanticDiff.removed} ~{semanticDiff.changed})
            </span>
          </div>
        )}
        {proofResult && (
          <div className={cn(
            'mt-0.5 flex items-center gap-1.5 text-[10.5px]',
            proofResult.passed ? 'text-green-300' : 'text-red-300',
          )}>
            {proofResult.passed
              ? <ShieldCheck size={10} />
              : <ShieldX size={10} />
            }
            <span>Proof {proofResult.passed ? 'passed' : 'failed'}</span>
            {proofResult.output && (
              <code className="truncate font-mono text-[10px] text-fg-subtle">{proofResult.output.slice(0, 80)}</code>
            )}
          </div>
        )}

        {testResult && (
          <div className="mt-1 rounded border border-border bg-bg-subtle/60 px-2 py-1.5 text-[11px]">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-fg-subtle uppercase">{testResult.runner}</span>
              {testResult.passed > 0 && (
                <span className="flex items-center gap-0.5 text-green-400">
                  <CheckCircle2 size={10} /> {testResult.passed} passed
                </span>
              )}
              {testResult.failed > 0 && (
                <span className="flex items-center gap-0.5 text-red-400">
                  <XCircle size={10} /> {testResult.failed} failed
                </span>
              )}
              {testResult.skipped > 0 && (
                <span className="text-fg-subtle">{testResult.skipped} skipped</span>
              )}
              {testResult.duration && (
                <span className="ml-auto text-fg-subtle">{testResult.duration}</span>
              )}
            </div>
            {testResult.failures.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {testResult.failures.slice(0, 5).map((f, i) => (
                  <li key={i} className="truncate font-mono text-[10px] text-red-300 opacity-80">
                    ✕ {f.name}
                  </li>
                ))}
                {testResult.failures.length > 5 && (
                  <li className="text-[10px] text-fg-subtle">…{testResult.failures.length - 5} more</li>
                )}
              </ul>
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
    return <AlertCircle size={11} className="shrink-0 text-yellow-400" />;
  if (status === 'approved')
    return <Loader2 size={11} className="shrink-0 animate-spin text-fg-muted" />;
  if (status === 'completed')
    return <Check size={11} className="shrink-0 text-green-400/70" />;
  if (status === 'denied') return <X size={11} className="shrink-0 text-fg-muted" />;
  if (status === 'error')
    return <AlertCircle size={11} className="shrink-0 text-red-400" />;
  return null;
}

function familyFor(tool: string): ToolFamily {
  if (tool === 'write_file' || tool === 'edit_file') return 'write';
  if (tool === 'bash') return 'run';
  if (tool === 'todo_write' || tool === 'plan_write') return 'meta';
  // web tools are reads — they fetch external content, no local mutation
  return 'read';
}

function familyBar(f: ToolFamily): string {
  switch (f) {
    case 'write':
      return 'bg-accent/60';
    case 'run':
      return 'bg-yellow-500/60';
    case 'meta':
      return 'bg-accent-2/60';
    case 'read':
    default:
      return 'bg-sky-500/40';
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
    case 'web_fetch':
      return Globe;
    case 'web_search':
      return SearchCheck;
    case 'git_status':
    case 'git_log':
    case 'git_diff':
      return GitBranch;
    default:
      return Wrench;
  }
}

/** Human verb for the tool, e.g. "Read", "Write", "Bash". */
function verbFor(tool: string): string {
  switch (tool) {
    case 'read_file':
      return 'Read';
    case 'write_file':
      return 'Write';
    case 'edit_file':
      return 'Edit';
    case 'glob':
      return 'Glob';
    case 'grep':
      return 'Grep';
    case 'list_dir':
      return 'List';
    case 'bash':
      return 'Bash';
    case 'todo_write':
      return 'Todos';
    case 'plan_write':
      return 'Plan';
    case 'web_fetch':
      return 'Fetch';
    case 'web_search':
      return 'Search Web';
    case 'git_status':
      return 'Git Status';
    case 'git_log':
      return 'Git Log';
    case 'git_diff':
      return 'Git Diff';
    default:
      return tool;
  }
}

/** The chip that follows the verb on the header line. */
function chipFor(tool: string, args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const a = args as Record<string, unknown>;
  switch (tool) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'list_dir':
      return str(a.path);
    case 'glob':
      return str(a.pattern);
    case 'grep':
      return a.glob ? `${str(a.pattern)} in ${str(a.glob)}` : str(a.pattern);
    case 'bash':
      return truncate(str(a.command), 100);
    case 'todo_write':
      return Array.isArray(a.todos) ? `${a.todos.length} items` : '';
    case 'plan_write':
      return 'drafting plan…';
    case 'web_fetch':
      return truncate(str(a.url), 80);
    case 'web_search':
      return truncate(str(a.query), 80);
    case 'git_status':
      return a.short ? '--short' : '';
    case 'git_log':
      return a.path ? `${str(a.path)} -${str(a.maxCommits)}` : `-${str(a.maxCommits ?? 20)}`;
    case 'git_diff':
      return a.path ? `${str(a.ref ?? 'HEAD')} -- ${str(a.path)}` : str(a.ref ?? 'HEAD');
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

function DiffPreview({ path, oldStr, newStr }: { path: string; oldStr: string; newStr: string }) {
  const patch = createPatch(path, oldStr, newStr, '', '', { context: 2 });
  const lines = patch.split('\n').slice(4);
  return (
    <pre className="mt-1 max-h-72 overflow-auto rounded border border-border bg-bg p-2 font-mono text-[11px] leading-snug">
      {lines.map((line, i) => {
        let cls = 'text-fg-muted';
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
  );
}
