'use client';

import { useState, useRef } from 'react';
import { Bot, Play, Square, CheckCircle, XCircle, Loader, X } from 'lucide-react';
import { startChatStream } from '@/lib/sseClient';
import { cn } from '@/lib/cn';

interface LogEntry {
  kind: 'task' | 'thinking' | 'tool' | 'result' | 'error' | 'done';
  text: string;
  ok?: boolean;
}

interface Props {
  sessionId: string;
  onClose: () => void;
}

const EXAMPLE_TASKS = [
  'Create a Java Hello World file',
  'Create a Python script that prints Fibonacci numbers',
  'Write a README.md for this project',
  'Create a simple HTML page with a counter button',
];

export function MiniAgentPanel({ sessionId, onClose }: Props) {
  const [task, setTask] = useState('');
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [phase, setPhase] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  function appendLog(entry: LogEntry) {
    setLog((prev) => [...prev, entry]);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
  }

  function run() {
    const trimmed = task.trim();
    if (!trimmed || running) return;

    setLog([{ kind: 'task', text: trimmed }]);
    setRunning(true);
    setPhase('thinking');

    abortRef.current = startChatStream(
      { sessionId, message: trimmed, autoApproveAll: true },
      {
        onEvent: (ev) => {
          switch (ev.type) {
            case 'activity_update':
              setPhase(ev.phase === 'idle' ? null : ev.phase);
              break;
            case 'thinking':
              appendLog({ kind: 'thinking', text: ev.text.slice(0, 200) });
              break;
            case 'tool_request': {
              const a = ev.args as Record<string, unknown> | null;
              const detail = typeof a?.path === 'string'
                ? a.path.split(/[\\/]/).pop()
                : typeof a?.command === 'string'
                  ? (a.command as string).slice(0, 50)
                  : undefined;
              appendLog({ kind: 'tool', text: detail ? `${ev.tool}  ${detail}` : ev.tool });
              break;
            }
            case 'tool_result':
              if (!ev.ok) {
                appendLog({ kind: 'error', text: ev.output.slice(0, 300) });
              }
              break;
            case 'delta':
              // Accumulate final assistant text as a single result entry
              setLog((prev) => {
                const last = prev[prev.length - 1];
                if (last?.kind === 'result') {
                  return [...prev.slice(0, -1), { ...last, text: last.text + ev.text }];
                }
                return [...prev, { kind: 'result', text: ev.text }];
              });
              break;
            case 'error':
              if (ev.code !== 'aborted') {
                appendLog({ kind: 'error', text: ev.message });
              }
              break;
            case 'done':
              appendLog({ kind: 'done', text: 'Task complete' });
              setRunning(false);
              setPhase(null);
              break;
          }
        },
        onError: () => {
          setRunning(false);
          setPhase(null);
        },
        onClose: () => {
          setRunning(false);
          setPhase(null);
        },
      },
    );
  }

  function stop() {
    abortRef.current?.abort();
    setRunning(false);
    setPhase(null);
  }

  return (
    <div className="flex w-[380px] shrink-0 flex-col border-l border-border bg-bg-panel">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot size={14} className="text-accent" />
          <span className="text-[13px] font-semibold text-fg">Mini Agent</span>
          {phase && (
            <span className="flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent">
              <Loader size={9} className="animate-spin" />
              {phase}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-fg-subtle transition hover:bg-bg-hover hover:text-fg"
        >
          <X size={13} />
        </button>
      </div>

      {/* Task input */}
      <div className="border-b border-border p-4">
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run();
          }}
          disabled={running}
          placeholder="Describe a task for the agent to run autonomously…"
          rows={3}
          className="w-full resize-none rounded-lg border border-border bg-bg px-3 py-2 text-[12px] text-fg placeholder:text-fg-subtle focus:border-accent/60 focus:outline-none disabled:opacity-50"
        />

        {/* Example chips */}
        {!task && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXAMPLE_TASKS.map((ex) => (
              <button
                key={ex}
                onClick={() => setTask(ex)}
                className="rounded-full border border-border bg-bg-subtle px-2 py-0.5 text-[10px] text-fg-subtle transition hover:border-accent/40 hover:text-fg"
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-fg-subtle">
            All tool calls auto-approved · Ctrl+Enter to run
          </span>
          {running ? (
            <button
              onClick={stop}
              className="flex items-center gap-1.5 rounded-lg bg-bg-hover px-3 py-1.5 text-[12px] font-medium text-fg-subtle transition hover:text-fg"
            >
              <Square size={11} />
              Stop
            </button>
          ) : (
            <button
              onClick={run}
              disabled={!task.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white shadow-sm transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play size={11} />
              Run
            </button>
          )}
        </div>
      </div>

      {/* Live log */}
      <div className="flex-1 overflow-y-auto p-3 text-[11px]">
        {log.length === 0 ? (
          <p className="text-center text-fg-subtle opacity-60 mt-8">
            Results will appear here…
          </p>
        ) : (
          <div className="space-y-1.5">
            {log.map((entry, i) => (
              <LogLine key={i} entry={entry} />
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  switch (entry.kind) {
    case 'task':
      return (
        <div className="flex items-start gap-2 rounded-md bg-accent/10 px-2.5 py-2">
          <Bot size={11} className="mt-0.5 shrink-0 text-accent" />
          <span className="font-medium text-fg">{entry.text}</span>
        </div>
      );
    case 'thinking':
      return (
        <div className="flex items-start gap-2 px-1 text-fg-subtle opacity-70">
          <span className="mt-0.5 shrink-0">💭</span>
          <span className="italic">{entry.text}</span>
        </div>
      );
    case 'tool':
      return (
        <div className="flex items-center gap-2 rounded px-2 py-1 font-mono text-blue-400">
          <span className="text-[10px] opacity-60">▶</span>
          <span>{entry.text}</span>
        </div>
      );
    case 'result':
      return (
        <div className="whitespace-pre-wrap break-words rounded-md bg-bg px-2.5 py-2 text-fg leading-relaxed">
          {entry.text}
        </div>
      );
    case 'error':
      return (
        <div className="flex items-start gap-2 rounded-md bg-red-500/10 px-2.5 py-2 text-red-400">
          <XCircle size={11} className="mt-0.5 shrink-0" />
          <span>{entry.text}</span>
        </div>
      );
    case 'done':
      return (
        <div className="flex items-center gap-2 text-green-400 px-1 pt-1">
          <CheckCircle size={11} />
          <span className="font-medium">{entry.text}</span>
        </div>
      );
    default:
      return null;
  }
}
