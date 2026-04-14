'use client';

import { useState, useEffect } from 'react';
import {
  Brain,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { MarkdownRenderer } from './MarkdownRenderer';

/* ── Thread colour palette ─────────────────────────────────── */
const THREAD_COLORS = ['#d97757', '#8b5cf6', '#06b6d4', '#22c55e', '#f472b6'];

function threadColor(index: number): string {
  return THREAD_COLORS[index % THREAD_COLORS.length];
}

/* ── Types ─────────────────────────────────────────────────── */
export interface SubAgentDisplay {
  index: number;
  description: string;
  status: 'running' | 'completed' | 'error';
  thinking: string[];
  toolCalls: Array<{ tool: string; args: unknown; output?: string }>;
  result?: string;
  startedAt: number;
  endedAt?: number;
}

interface Props {
  agents: SubAgentDisplay[];
  allDone: boolean;
}

/* ── Helpers ───────────────────────────────────────────────── */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncate(value: unknown, max = 60): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  return str.length > max ? str.slice(0, max) + '\u2026' : str;
}

/* ── ThreadCard ────────────────────────────────────────────── */
function ThreadCard({ agent }: { agent: SubAgentDisplay }) {
  const color = threadColor(agent.index);
  const [expanded, setExpanded] = useState(agent.status !== 'running');
  const [now, setNow] = useState(Date.now());

  // Expand automatically when completed
  useEffect(() => {
    if (agent.status === 'completed' || agent.status === 'error') {
      setExpanded(true);
    }
  }, [agent.status]);

  // Tick elapsed time while running
  useEffect(() => {
    if (agent.status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [agent.status]);

  const durationMs =
    agent.status === 'running'
      ? now - agent.startedAt
      : agent.endedAt != null
        ? agent.endedAt - agent.startedAt
        : null;

  const hasContent =
    agent.thinking.length > 0 || agent.toolCalls.length > 0 || agent.result;

  return (
    <div
      className="animate-fadeInUp"
      style={{ animationDelay: `${80 * agent.index}ms`, animationFillMode: 'both' }}
    >
      {/* Thread line + content */}
      <div className="relative pl-6">
        {/* Vertical thread line */}
        <div
          className={cn(
            'absolute left-[4px] top-0 bottom-0 w-[2px] rounded-full',
            agent.status === 'error' && 'bg-red-500/70',
          )}
          style={
            agent.status === 'running'
              ? {
                  background: `linear-gradient(180deg, ${color}, ${color}44, ${color})`,
                  backgroundSize: '100% 200%',
                  animation: 'shimmer 1.6s linear infinite',
                }
              : agent.status !== 'error'
                ? { backgroundColor: color }
                : undefined
          }
        />

        {/* Header row */}
        <div className="flex items-center gap-2 pb-2">
          {/* Colour dot */}
          <div
            className="h-[6px] w-[6px] shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />

          {/* Description */}
          <span className="flex-1 truncate text-[13px] font-medium text-fg">
            {agent.description}
          </span>

          {/* Status badge */}
          {agent.status === 'running' && (
            <span className="flex items-center gap-1 rounded-full bg-bg-hover px-2 py-0.5 text-[10px] text-fg-muted">
              <Loader2 size={10} className="animate-spin" style={{ color }} />
              running
            </span>
          )}
          {agent.status === 'completed' && (
            <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] text-green-400">
              <CheckCircle2 size={10} />
              done
            </span>
          )}
          {agent.status === 'error' && (
            <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] text-red-400">
              <XCircle size={10} />
              error
            </span>
          )}

          {/* Duration */}
          {durationMs != null && durationMs > 0 && (
            <span className="text-[10px] tabular-nums text-fg-subtle">
              {formatDuration(durationMs)}
            </span>
          )}

          {/* Collapse toggle */}
          {hasContent && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="rounded p-0.5 text-fg-subtle transition hover:bg-bg-hover hover:text-fg"
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          )}
        </div>

        {/* Expanded content */}
        {expanded && hasContent && (
          <div className="space-y-2 pb-4 pl-3">
            {/* Thinking nodes */}
            {agent.thinking.map((thought, i) => (
              <div key={`t-${i}`} className="flex items-start gap-2">
                <Brain size={12} className="mt-0.5 shrink-0 text-accent-2" />
                <span className="text-[12px] italic leading-relaxed text-fg-muted">
                  {thought}
                </span>
              </div>
            ))}

            {/* Tool call nodes */}
            {agent.toolCalls.map((tc, i) => (
              <div key={`tc-${i}`} className="flex flex-wrap items-center gap-1.5">
                <span
                  className="inline-flex items-center gap-1 rounded border border-border bg-bg-subtle px-2 py-0.5 text-[11px] font-medium text-fg-muted"
                >
                  <Wrench size={10} className="text-fg-subtle" />
                  {tc.tool}
                </span>
                <span className="truncate text-[11px] text-fg-subtle">
                  {truncate(tc.args)}
                </span>
                {tc.output && (
                  <span className="ml-auto max-w-[50%] truncate text-[10px] text-fg-subtle">
                    {truncate(tc.output, 80)}
                  </span>
                )}
              </div>
            ))}

            {/* Result */}
            {agent.result && (
              <div className="mt-1 rounded border border-border bg-bg-subtle/50 p-3">
                <MarkdownRenderer>{agent.result}</MarkdownRenderer>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main panel ────────────────────────────────────────────── */
export function SubAgentPanel({ agents, allDone }: Props) {
  const runningCount = agents.filter((a) => a.status === 'running').length;

  // Total duration for convergence node
  const totalDurationMs =
    allDone && agents.length > 0
      ? Math.max(...agents.map((a) => a.endedAt ?? a.startedAt)) -
        Math.min(...agents.map((a) => a.startedAt))
      : null;

  return (
    <div className="relative space-y-0 py-2">
      {/* ── Origin node ──────────────────────────────────── */}
      <div className="flex items-center gap-3 pb-3 pl-0">
        <div className="relative flex items-center justify-center">
          <div
            className={cn(
              'h-[10px] w-[10px] rounded-full bg-accent',
              !allDone && 'animate-pulseDot',
            )}
          />
          {!allDone && (
            <div className="absolute inset-0 rounded-full bg-accent opacity-30 blur-[6px]" />
          )}
        </div>
        <span className="text-[12px] font-medium text-fg-muted">
          {allDone
            ? `All ${agents.length} agents completed`
            : `${runningCount} agent${runningCount !== 1 ? 's' : ''} running`}
        </span>
      </div>

      {/* ── Thread cards ─────────────────────────────────── */}
      <div className="space-y-1">
        {agents.map((agent) => (
          <ThreadCard key={agent.index} agent={agent} />
        ))}
      </div>

      {/* ── Convergence node ─────────────────────────────── */}
      {allDone && agents.length > 0 && (
        <div className="flex items-center gap-3 pt-3 pl-0 animate-fadeInUp">
          <div className="relative flex items-center justify-center">
            <div className="h-[10px] w-[10px] rounded-full bg-accent" />
            <div className="absolute inset-0 rounded-full bg-accent opacity-25 blur-[6px]" />
          </div>
          <span className="text-[12px] font-medium text-fg-muted">
            All {agents.length} agents completed
            {totalDurationMs != null && totalDurationMs > 0 && (
              <span className="ml-1 text-fg-subtle">
                ({formatDuration(totalDurationMs)})
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
