'use client';

import { useEffect, useState } from 'react';
import { Shield, FlaskConical, BookOpen, Wrench, Camera, History, Network, Users, Brain, Eye, PenLine, Terminal, Bot, Download } from 'lucide-react';
import { useChatStore } from '@/lib/store';
import { getSession, exportSessionUrl } from '@/lib/api';
import { CostMeter } from './CostMeter';
import { cn } from '@/lib/cn';

interface Props {
  sessionId: string | null;
  onToggleGuardrails: () => void;
  onOpenCustomTools: () => void;
  onToggleSnapshots: () => void;
  onToggleRegret: () => void;
  onOpenPeerReview: () => void;
  onOpenMiniAgent: () => void;
  miniAgentOpen?: boolean;
  onOpenTokenDashboard?: () => void;
}

export function HeroHeader({ sessionId, onToggleGuardrails, onOpenCustomTools, onToggleSnapshots, onToggleRegret, onOpenPeerReview, onOpenMiniAgent, miniAgentOpen, onOpenTokenDashboard }: Props) {
  const streaming = useChatStore((s) => s.streaming);
  const activity = useChatStore((s) => s.activity);
  const guardrailsOpen = useChatStore((s) => s.guardrailsOpen);
  const contextLensOpen = useChatStore((s) => s.contextLensOpen);
  const hypothesisLogOpen = useChatStore((s) => s.hypothesisLogOpen);
  const contextFiles = useChatStore((s) => s.contextFiles);
  const hypotheses = useChatStore((s) => s.hypotheses);
  const regrets = useChatStore((s) => s.regrets);
  const mentalModelOpen = useChatStore((s) => s.mentalModelOpen);
  const mentalModelNodes = useChatStore((s) => s.mentalModel.nodes);
  const setContextLensOpen = useChatStore((s) => s.setContextLensOpen);
  const setHypothesisLogOpen = useChatStore((s) => s.setHypothesisLogOpen);
  const setMentalModelOpen = useChatStore((s) => s.setMentalModelOpen);
  const [title, setTitle] = useState<string>('New session');

  useEffect(() => {
    if (!sessionId) {
      setTitle('New session');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const s = await getSession(sessionId);
        if (!cancelled) setTitle(s.title || 'New session');
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const pendingHypotheses = hypotheses.filter((h) => h.result === 'pending').length;

  return (
    <header className="flex items-center justify-between border-b border-border bg-bg-panel/60 px-6 py-3 backdrop-blur">

      <div className="flex min-w-0 items-center gap-3">
        <h1 className="truncate text-[14px] font-semibold tracking-tight text-fg">{title}</h1>
        {streaming && <ActivityPill activity={activity} />}
      </div>
      <div className="flex items-center gap-1.5">
        <CostMeter sessionId={sessionId} onOpenDashboard={onOpenTokenDashboard} />

        {/* Context Lens */}
        <button
          onClick={() => setContextLensOpen(!contextLensOpen)}
          title="Context Lens — files in agent memory"
          className={cn(
            'flex items-center gap-1 rounded px-2 py-1 text-[11px] transition',
            contextLensOpen
              ? 'bg-accent/20 text-accent'
              : 'text-fg-subtle hover:bg-bg-hover hover:text-fg',
          )}
        >
          <BookOpen size={12} />
          {contextFiles.length > 0 && (
            <span className="text-[10px]">{contextFiles.length}</span>
          )}
        </button>

        {/* Mental Model */}
        <button
          onClick={() => setMentalModelOpen(!mentalModelOpen)}
          title="Mental Model — agent's working memory graph"
          className={cn(
            'flex items-center gap-1 rounded px-2 py-1 text-[11px] transition',
            mentalModelOpen
              ? 'bg-accent/20 text-accent'
              : 'text-fg-subtle hover:bg-bg-hover hover:text-fg',
          )}
        >
          <Network size={12} />
          {mentalModelNodes.length > 0 && (
            <span className="text-[10px]">{mentalModelNodes.length}</span>
          )}
        </button>

        {/* Hypothesis Log */}
        <button
          onClick={() => setHypothesisLogOpen(!hypothesisLogOpen)}
          title="Hypothesis Engine — intent vs outcome"
          className={cn(
            'flex items-center gap-1 rounded px-2 py-1 text-[11px] transition',
            hypothesisLogOpen
              ? 'bg-accent/20 text-accent'
              : 'text-fg-subtle hover:bg-bg-hover hover:text-fg',
          )}
        >
          <FlaskConical size={12} />
          {pendingHypotheses > 0 && (
            <span className="text-[10px] text-yellow-400">{pendingHypotheses}</span>
          )}
        </button>

        {/* Guardrails */}
        <button
          onClick={onToggleGuardrails}
          title="Guardrails — pre-execution rules"
          className={cn(
            'flex items-center gap-1 rounded px-2 py-1 text-[11px] transition',
            guardrailsOpen
              ? 'bg-accent/20 text-accent'
              : 'text-fg-subtle hover:bg-bg-hover hover:text-fg',
          )}
        >
          <Shield size={12} />
        </button>

        {/* Regret Journal */}
        <button
          onClick={onToggleRegret}
          title="Regret Journal — thrash detection"
          className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-fg-subtle transition hover:bg-bg-hover hover:text-fg"
        >
          <History size={12} />
          {regrets.length > 0 && (
            <span className="text-[10px] text-yellow-400">{regrets.length}</span>
          )}
        </button>

        {/* Snapshots */}
        <button
          onClick={onToggleSnapshots}
          title="Snapshot Timeline — time-travel checkpoints"
          className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-fg-subtle transition hover:bg-bg-hover hover:text-fg"
        >
          <Camera size={12} />
        </button>

        {/* Peer Review */}
        <button
          onClick={onOpenPeerReview}
          title="Peer Review — regenerate last turn at two temperatures"
          className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-fg-subtle transition hover:bg-bg-hover hover:text-fg"
        >
          <Users size={12} />
        </button>

        {/* Mini Agent */}
        <button
          onClick={onOpenMiniAgent}
          title="Mini Agent — auto-run tasks without approval"
          disabled={!sessionId}
          className={cn(
            'flex items-center gap-1 rounded px-2 py-1 text-[11px] transition disabled:opacity-40',
            miniAgentOpen
              ? 'bg-accent/20 text-accent'
              : 'text-fg-subtle hover:bg-bg-hover hover:text-fg',
          )}
        >
          <Bot size={12} />
        </button>

        {/* Custom Tools */}
        <button
          onClick={onOpenCustomTools}
          title="Custom Tool Builder"
          className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-fg-subtle transition hover:bg-bg-hover hover:text-fg"
        >
          <Wrench size={12} />
        </button>

        {/* Export session as markdown */}
        {sessionId && (
          <a
            href={exportSessionUrl(sessionId)}
            download
            title="Export session as Markdown"
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-fg-subtle transition hover:bg-bg-hover hover:text-fg"
          >
            <Download size={12} />
          </a>
        )}
      </div>
    </header>
  );
}

// ── Activity Pill ─────────────────────────────────────────────────────────────

type Activity = { phase: 'thinking' | 'reading' | 'writing' | 'running' | 'idle'; tool?: string; detail?: string } | null;

const PHASE_CONFIG = {
  thinking: { Icon: Brain,    label: 'Thinking',  color: 'text-purple-400' },
  reading:  { Icon: Eye,      label: 'Reading',   color: 'text-blue-400'   },
  writing:  { Icon: PenLine,  label: 'Editing',   color: 'text-amber-400'  },
  running:  { Icon: Terminal, label: 'Running',   color: 'text-green-400'  },
  idle:     { Icon: Brain,    label: '',          color: 'text-fg-subtle'  },
} as const;

function ActivityPill({ activity }: { activity: Activity }) {
  const phase = activity?.phase ?? 'thinking';
  if (phase === 'idle' || !activity) {
    // still streaming but no specific phase yet — show generic pulse
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
        <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-accent" />
        thinking
      </span>
    );
  }

  const { Icon, label, color } = PHASE_CONFIG[phase];
  const detail = activity.detail;

  return (
    <span className={cn('flex items-center gap-1.5 text-[11px]', color)}>
      <Icon size={11} className="shrink-0 opacity-80" />
      <span className="font-medium">{label}</span>
      {detail && (
        <span className="max-w-[180px] truncate font-mono text-[10px] opacity-70">
          {detail}
        </span>
      )}
      <span className="h-1 w-1 animate-pulseDot rounded-full bg-current opacity-60" />
    </span>
  );
}
