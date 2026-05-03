'use client';

import { useEffect, useState } from 'react';
import {
  Shield,
  FlaskConical,
  BookOpen,
  Wrench,
  Camera,
  History,
  Network,
  Users,
  Brain,
  Eye,
  PenLine,
  Terminal,
  Bot,
  Download,
} from 'lucide-react';
import { useChatStore } from '@/lib/store';
import { getSession, exportSessionUrl } from '@/lib/api';
import { CostMeter } from './CostMeter';
import { IconButton } from '@/lib/components';
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

/**
 * Top-of-screen header. Title on the left, activity pill while streaming,
 * and a row of toggle/action buttons on the right.
 *
 * Every button uses IconButton, which means:
 *   - Built-in aria-label (required by the type system)
 *   - Consistent toggle styling via `pressed`
 *   - Built-in count/dot badge via `count`
 * No more hand-rolled classNames duplicated nine times.
 */
export function HeroHeader({
  sessionId,
  onToggleGuardrails,
  onOpenCustomTools,
  onToggleSnapshots,
  onToggleRegret,
  onOpenPeerReview,
  onOpenMiniAgent,
  miniAgentOpen,
  onOpenTokenDashboard,
}: Props) {
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
        /* network error — keep prior title */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const pendingHypotheses = hypotheses.filter((h) => h.result === 'pending').length;

  return (
    <header className="flex items-center justify-between gap-4 border-b border-border bg-bg-panel/60 px-6 py-3 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="truncate text-[14px] font-semibold tracking-tight text-fg">{title}</h1>
        {streaming && <ActivityPill activity={activity} />}
      </div>

      <div className="flex items-center gap-1">
        <CostMeter sessionId={sessionId} onOpenDashboard={onOpenTokenDashboard} />

        <IconButton
          icon={<BookOpen />}
          aria-label="Toggle Context Lens"
          title="Context Lens — files in agent memory"
          pressed={contextLensOpen}
          onClick={() => setContextLensOpen(!contextLensOpen)}
          count={contextFiles.length || undefined}
        />

        <IconButton
          icon={<Network />}
          aria-label="Toggle Mental Model"
          title="Mental Model — agent's working memory graph"
          pressed={mentalModelOpen}
          onClick={() => setMentalModelOpen(!mentalModelOpen)}
          count={mentalModelNodes.length || undefined}
        />

        <IconButton
          icon={<FlaskConical />}
          aria-label="Toggle Hypothesis Engine"
          title="Hypothesis Engine — intent vs outcome"
          pressed={hypothesisLogOpen}
          onClick={() => setHypothesisLogOpen(!hypothesisLogOpen)}
          count={pendingHypotheses || undefined}
          countTone="warn"
        />

        <IconButton
          icon={<Shield />}
          aria-label="Toggle Guardrails"
          title="Guardrails — pre-execution rules"
          pressed={guardrailsOpen}
          onClick={onToggleGuardrails}
        />

        <IconButton
          icon={<History />}
          aria-label="Open Regret Journal"
          title="Regret Journal — thrash detection"
          onClick={onToggleRegret}
          count={regrets.length || undefined}
          countTone="warn"
        />

        <IconButton
          icon={<Camera />}
          aria-label="Open Snapshots"
          title="Snapshot Timeline — time-travel checkpoints"
          onClick={onToggleSnapshots}
        />

        <IconButton
          icon={<Users />}
          aria-label="Open Peer Review"
          title="Peer Review — regenerate last turn at two temperatures"
          onClick={onOpenPeerReview}
        />

        <IconButton
          icon={<Bot />}
          aria-label="Toggle Mini Agent"
          title="Mini Agent — auto-run tasks without approval"
          pressed={miniAgentOpen}
          disabled={!sessionId}
          onClick={onOpenMiniAgent}
        />

        <IconButton
          icon={<Wrench />}
          aria-label="Open Custom Tool Builder"
          title="Custom Tool Builder"
          onClick={onOpenCustomTools}
        />

        {sessionId && (
          // Native <a download> — IconButton is a button, not a link, so the
          // download attr would be ignored. Kept inline but mirrors the look.
          <a
            href={exportSessionUrl(sessionId)}
            download
            aria-label="Export session as Markdown"
            title="Export session as Markdown"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg"
          >
            <Download size={14} />
          </a>
        )}
      </div>
    </header>
  );
}

// ── Activity Pill ─────────────────────────────────────────────────────────────

type Activity =
  | { phase: 'thinking' | 'reading' | 'writing' | 'running' | 'idle'; tool?: string; detail?: string }
  | null;

const PHASE_CONFIG = {
  thinking: { Icon: Brain, label: 'Thinking', color: 'text-purple-400' },
  reading: { Icon: Eye, label: 'Reading', color: 'text-blue-400' },
  writing: { Icon: PenLine, label: 'Editing', color: 'text-amber-400' },
  running: { Icon: Terminal, label: 'Running', color: 'text-green-400' },
  idle: { Icon: Brain, label: '', color: 'text-fg-subtle' },
} as const;

function ActivityPill({ activity }: { activity: Activity }) {
  const phase = activity?.phase ?? 'thinking';
  if (phase === 'idle' || !activity) {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-fg-subtle" aria-live="polite">
        <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-accent" aria-hidden />
        thinking
      </span>
    );
  }

  const { Icon, label, color } = PHASE_CONFIG[phase];
  const detail = activity.detail;

  return (
    <span
      className={cn('flex items-center gap-1.5 text-[11px]', color)}
      aria-live="polite"
      aria-label={`Agent ${label.toLowerCase()}${detail ? `: ${detail}` : ''}`}
    >
      <Icon size={11} className="shrink-0 opacity-80" aria-hidden />
      <span className="font-medium">{label}</span>
      {detail && (
        <span className="max-w-[180px] truncate font-mono text-[10px] opacity-70">{detail}</span>
      )}
      <span className="h-1 w-1 animate-pulseDot rounded-full bg-current opacity-60" aria-hidden />
    </span>
  );
}
