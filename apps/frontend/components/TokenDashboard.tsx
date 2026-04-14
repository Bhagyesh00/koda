'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  X,
  Activity,
  Zap,
  Clock,
  MessageSquare,
  Loader2,
  AlertCircle,
  Calendar,
} from 'lucide-react';
import { cn } from '@/lib/cn';

/* ── Types ──────────────────────────────────────────────────────────────────── */

interface PeriodStats {
  totalTokens: number;
  totalTurns: number;
  totalTimeMs: number;
  bySession: Record<string, { tokens: number; turns: number }>;
  byDay: Array<{ date: string; tokens: number; turns: number }>;
}

interface UsageSummary {
  today: PeriodStats;
  week: PeriodStats;
  month: PeriodStats;
  allTime: PeriodStats;
}

interface Props {
  onClose: () => void;
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */

type PeriodKey = 'today' | 'week' | 'month' | 'allTime' | 'custom';

const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: 'Today',
  week: 'Week',
  month: 'Month',
  allTime: 'All Time',
  custom: 'Custom',
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  const sec = ms / 1_000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = sec / 60;
  if (min < 60) return `${min.toFixed(1)}m`;
  const hr = min / 60;
  return `${hr.toFixed(1)}h`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function weekdayLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

/** A small, deterministic palette for session dots */
const SESSION_DOT_COLORS = [
  '#d97757', '#e8a87c', '#6ee7b7', '#7dd3fc', '#c4b5fd',
  '#fca5a5', '#fcd34d', '#86efac', '#a5b4fc', '#f9a8d4',
  '#34d399', '#60a5fa', '#a78bfa', '#fb923c', '#2dd4bf',
];

function dotColor(i: number): string {
  return SESSION_DOT_COLORS[i % SESSION_DOT_COLORS.length];
}

/* ── Component ──────────────────────────────────────────────────────────────── */

export function TokenDashboard({ onClose }: Props) {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePeriod, setActivePeriod] = useState<PeriodKey>('week');
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);

  // Custom date range
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [customData, setCustomData] = useState<PeriodStats | null>(null);
  const [customLoading, setCustomLoading] = useState(false);

  // Fetch summary on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/usage/summary');
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = (await res.json()) as UsageSummary;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Escape to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Fetch custom range
  const fetchCustom = useCallback(async () => {
    if (!customFrom || !customTo) return;
    setCustomLoading(true);
    try {
      const res = await fetch(
        `/api/usage/summary?from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}`,
      );
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = (await res.json()) as { custom: PeriodStats };
      setCustomData(json.custom ?? null);
    } catch {
      setCustomData(null);
    } finally {
      setCustomLoading(false);
    }
  }, [customFrom, customTo]);

  // Active period stats
  const activeStats: PeriodStats | null = useMemo(() => {
    if (activePeriod === 'custom') return customData;
    return data ? data[activePeriod] : null;
  }, [data, activePeriod, customData]);

  // Chart data (limit to 14 bars)
  const chartBars = useMemo(() => {
    if (!activeStats) return [];
    const days = activeStats.byDay.slice(-14);
    const maxTokens = Math.max(...days.map((d) => d.tokens), 1);
    return days.map((d) => ({
      ...d,
      pct: (d.tokens / maxTokens) * 100,
    }));
  }, [activeStats]);

  // Session list, sorted descending by tokens
  const sessions = useMemo(() => {
    if (!activeStats) return [];
    const entries = Object.entries(activeStats.bySession).map(([id, s]) => ({
      id,
      ...s,
    }));
    entries.sort((a, b) => b.tokens - a.tokens);
    return entries;
  }, [activeStats]);

  const maxSessionTokens = sessions.length > 0 ? sessions[0].tokens : 1;

  // All summary cards data
  const summaryCards = useMemo(() => {
    if (!data) return [];
    const keys: Array<Exclude<PeriodKey, 'custom'>> = ['today', 'week', 'month', 'allTime'];
    return keys.map((key) => ({
      key,
      label: PERIOD_LABELS[key],
      tokens: data[key].totalTokens,
      turns: data[key].totalTurns,
      time: data[key].totalTimeMs,
    }));
  }, [data]);

  const periodKeys: PeriodKey[] = ['today', 'week', 'month', 'allTime', 'custom'];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
      {/* Accent glow */}
      <div
        className="absolute left-1/2 top-1/4 h-[320px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20"
        style={{ background: 'radial-gradient(ellipse, rgba(217, 119, 87, 0.45), transparent 70%)' }}
      />

      {/* Main panel */}
      <div
        className="relative z-10 flex w-full max-w-2xl animate-fadeInUp flex-col overflow-hidden rounded-2xl border border-white/[0.06]"
        style={{
          maxHeight: '80vh',
          background: 'linear-gradient(180deg, rgba(22, 26, 32, 0.97) 0%, rgba(11, 12, 15, 0.98) 100%)',
          boxShadow:
            '0 24px 80px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.04), 0 0 60px rgba(217, 119, 87, 0.08)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 pb-3 pt-4">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15">
            <Activity size={16} className="text-accent" />
            {/* Live pulse dot */}
            <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-pulseDot rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
            </span>
          </div>
          <div className="flex-1">
            <h2 className="text-[14px] font-semibold text-fg">Token Usage</h2>
            <p className="text-[11px] text-fg-subtle">Mission Control</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-subtle transition hover:bg-white/[0.06] hover:text-fg"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Period Tabs ────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1 px-5 pb-3">
          {periodKeys.map((key) => (
            <button
              key={key}
              onClick={() => setActivePeriod(key)}
              className={cn(
                'rounded-full px-3 py-1 text-[11px] font-medium transition',
                activePeriod === key
                  ? 'bg-accent text-white shadow-glow shadow-accent-glow/30'
                  : 'text-fg-subtle hover:bg-white/[0.06] hover:text-fg-muted',
              )}
            >
              {PERIOD_LABELS[key]}
            </button>
          ))}
        </div>

        {/* Custom date range picker */}
        {activePeriod === 'custom' && (
          <div className="mx-5 mb-3 flex items-center gap-2 rounded-lg border border-border bg-white/[0.02] px-3 py-2">
            <Calendar size={12} className="shrink-0 text-fg-subtle" />
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-6 rounded border border-border bg-transparent px-2 text-[11px] text-fg outline-none focus:border-accent/40"
            />
            <span className="text-[10px] text-fg-subtle">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-6 rounded border border-border bg-transparent px-2 text-[11px] text-fg outline-none focus:border-accent/40"
            />
            <button
              onClick={() => void fetchCustom()}
              disabled={!customFrom || !customTo || customLoading}
              className="rounded bg-accent/80 px-2.5 py-1 text-[10px] font-medium text-white transition hover:bg-accent disabled:opacity-40"
            >
              {customLoading ? 'Loading...' : 'Apply'}
            </button>
          </div>
        )}

        {/* ── Scrollable body ────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center justify-center gap-2 py-16">
              <Loader2 size={22} className="animate-spin text-accent/60" />
              <span className="text-[12px] text-fg-subtle">Loading usage data...</span>
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-[12px] text-red-300">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Data loaded */}
          {!loading && !error && data && (
            <>
              {/* ── Summary Cards ────────────────────────────────────────────── */}
              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {summaryCards.map((card) => (
                  <button
                    key={card.key}
                    onClick={() => setActivePeriod(card.key)}
                    className={cn(
                      'group relative flex flex-col items-start rounded-xl border px-3.5 py-3 text-left transition-all duration-200',
                      activePeriod === card.key
                        ? 'border-accent/40 bg-accent/[0.07]'
                        : 'border-white/[0.04] hover:border-white/[0.08]',
                    )}
                    style={{
                      background:
                        activePeriod === card.key
                          ? undefined
                          : 'rgba(17, 19, 23, 0.92)',
                      backdropFilter: 'blur(16px)',
                    }}
                  >
                    {/* Glow border for active */}
                    {activePeriod === card.key && (
                      <div
                        className="pointer-events-none absolute inset-0 rounded-xl"
                        style={{
                          boxShadow: '0 0 20px -4px rgba(217, 119, 87, 0.25), inset 0 0 0 1px rgba(217, 119, 87, 0.15)',
                        }}
                      />
                    )}
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                      {card.label}
                    </span>
                    <span
                      className={cn(
                        'mt-1 font-mono text-[24px] font-bold leading-none',
                        activePeriod === card.key ? 'text-accent' : 'text-accent-2',
                      )}
                    >
                      {formatTokens(card.tokens)}
                    </span>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="flex items-center gap-0.5 text-[11px] text-fg-subtle">
                        <MessageSquare size={9} />
                        {card.turns} turns
                      </span>
                      <span className="flex items-center gap-0.5 text-[11px] text-fg-subtle">
                        <Clock size={9} />
                        {formatDuration(card.time)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              {/* ── Usage Bar Chart ──────────────────────────────────────────── */}
              {activeStats && chartBars.length > 0 && (
                <div className="mb-4 rounded-xl border border-white/[0.04] p-4" style={{ background: 'rgba(17, 19, 23, 0.92)', backdropFilter: 'blur(16px)' }}>
                  <div className="mb-3 flex items-center gap-2">
                    <Zap size={12} className="text-accent" />
                    <span className="text-[12px] font-medium text-fg-muted">Usage Over Time</span>
                    <span className="ml-auto text-[10px] text-fg-subtle">
                      {formatTokens(activeStats.totalTokens)} total
                    </span>
                  </div>

                  {/* Bars */}
                  <div className="flex items-end gap-1" style={{ height: 140 }}>
                    {chartBars.map((bar, i) => (
                      <div
                        key={bar.date}
                        className="group relative flex flex-1 flex-col items-center"
                        style={{ height: '100%' }}
                        onMouseEnter={() => setHoveredBar(i)}
                        onMouseLeave={() => setHoveredBar(null)}
                      >
                        {/* Tooltip */}
                        {hoveredBar === i && (
                          <div
                            className="absolute -top-9 z-20 whitespace-nowrap rounded-md border border-border px-2 py-1 text-[10px] text-fg shadow-lg"
                            style={{ background: 'rgba(17, 19, 23, 0.97)' }}
                          >
                            <span className="font-mono font-semibold text-accent">{formatTokens(bar.tokens)}</span>
                            <span className="ml-1 text-fg-subtle">{bar.turns} turns</span>
                          </div>
                        )}

                        {/* Bar column container */}
                        <div className="flex w-full flex-1 items-end justify-center">
                          <div
                            className={cn(
                              'w-full max-w-[28px] rounded-t-md transition-all duration-200',
                              hoveredBar === i ? 'opacity-100' : 'opacity-80',
                            )}
                            style={{
                              height: `${Math.max(bar.pct, 2)}%`,
                              background: hoveredBar === i
                                ? 'linear-gradient(to top, #d97757, #e8a87c)'
                                : 'linear-gradient(to top, rgba(217, 119, 87, 0.6), rgba(232, 168, 124, 0.6))',
                              boxShadow: hoveredBar === i
                                ? '0 0 12px rgba(217, 119, 87, 0.3)'
                                : 'none',
                            }}
                          />
                        </div>

                        {/* Date label */}
                        <span className="mt-1.5 text-[10px] font-mono text-fg-subtle">
                          {chartBars.length <= 7 ? weekdayLabel(bar.date) : shortDate(bar.date)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty chart state */}
              {activeStats && chartBars.length === 0 && (
                <div className="mb-4 flex flex-col items-center gap-2 rounded-xl border border-white/[0.04] py-8" style={{ background: 'rgba(17, 19, 23, 0.92)' }}>
                  <Activity size={20} className="text-fg-subtle/40" />
                  <span className="text-[12px] text-fg-subtle">No usage data for this period</span>
                </div>
              )}

              {/* ── Session Breakdown ────────────────────────────────────────── */}
              {activeStats && sessions.length > 0 && (
                <div className="rounded-xl border border-white/[0.04] p-4" style={{ background: 'rgba(17, 19, 23, 0.92)', backdropFilter: 'blur(16px)' }}>
                  <div className="mb-3 flex items-center gap-2">
                    <MessageSquare size={12} className="text-accent" />
                    <span className="text-[12px] font-medium text-fg-muted">Sessions</span>
                    <span className="ml-auto text-[10px] text-fg-subtle">
                      {sessions.length} session{sessions.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  <div className="max-h-[180px] overflow-y-auto">
                    {sessions.map((s, i) => (
                      <div key={s.id} className="group mb-2 last:mb-0">
                        <div className="flex items-center gap-2.5">
                          {/* Colored dot */}
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: dotColor(i) }}
                          />
                          {/* Session name */}
                          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg-muted">
                            {s.id}
                          </span>
                          {/* Stats */}
                          <span className="shrink-0 font-mono text-[11px] text-accent-2">
                            {formatTokens(s.tokens)}
                          </span>
                          <span className="shrink-0 text-[10px] text-fg-subtle">
                            {s.turns} turns
                          </span>
                        </div>
                        {/* Progress bar */}
                        <div className="ml-[18px] mt-1 h-1 overflow-hidden rounded-full bg-white/[0.04]">
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                              width: `${(s.tokens / maxSessionTokens) * 100}%`,
                              background: `linear-gradient(90deg, ${dotColor(i)}88, ${dotColor(i)})`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-t border-white/[0.04] px-5 py-3">
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-accent" />
            <span className="font-mono text-[11px] text-fg-muted">
              {data
                ? `${formatTokens(data.allTime.totalTokens)} tokens lifetime`
                : 'Loading...'}
            </span>
          </div>
          <span className="text-[10px] text-fg-subtle">
            {data ? `${data.allTime.totalTurns.toLocaleString()} total turns` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
