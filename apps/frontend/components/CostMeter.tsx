'use client';

import { useState, useRef, useEffect } from 'react';
import { Coins, X, Check } from 'lucide-react';
import { useChatStore } from '@/lib/store';
import { setTokenBudget } from '@/lib/api';
import { cn } from '@/lib/cn';

interface Props {
  sessionId: string | null;
  onOpenDashboard?: () => void;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

export function CostMeter({ sessionId, onOpenDashboard }: Props) {
  const sessionTokens = useChatStore((s) => s.sessionTokens);
  const tokenBudget = useChatStore((s) => s.tokenBudget);
  const setTokenBudgetLocal = useChatStore((s) => s.setTokenBudgetLocal);
  const addToast = useChatStore((s) => s.addToast);
  const [editing, setEditing] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const pct = tokenBudget ? Math.min(100, (sessionTokens / tokenBudget) * 100) : 0;
  const near = pct >= 80 && pct < 100;
  const over = pct >= 100;

  // Focus input when editing opens
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // Close on outside click
  useEffect(() => {
    if (!editing) return;
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setEditing(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [editing]);

  async function saveBudget() {
    if (!sessionId) return;
    const raw = budgetInput.trim();
    let n: number | null = null;

    if (raw) {
      // Support shorthand: 10k, 1.5m, etc
      const match = raw.match(/^([\d.]+)\s*([km])?$/i);
      if (!match) { addToast('Invalid format. Use numbers like 10000, 10k, or 1.5M', 'error'); return; }
      let val = parseFloat(match[1]!);
      const suffix = (match[2] ?? '').toLowerCase();
      if (suffix === 'k') val *= 1_000;
      if (suffix === 'm') val *= 1_000_000;
      n = Math.round(val);
      if (n < 1_000) {
        addToast('Minimum budget is 1k tokens', 'error');
        return;
      }
    }

    try {
      await setTokenBudget(sessionId, n);
      setTokenBudgetLocal(n ?? undefined);
      addToast(n ? `Budget: ${formatTokens(n)}` : 'Budget removed', 'success');
    } catch (e) {
      addToast((e as Error).message, 'error');
    }
    setEditing(false);
  }

  if (!sessionId) return null;

  return (
    <div ref={containerRef} className="relative flex items-center">
      {/* Token display — click to open dashboard */}
      <button
        onClick={onOpenDashboard}
        className={cn(
          'flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] transition',
          'hover:bg-white/[0.04]',
          over ? 'text-red-400' : near ? 'text-yellow-400' : 'text-fg-subtle',
        )}
        title="Open token usage dashboard"
      >
        <Coins size={11} />
        <span className="font-mono">
          {formatTokens(sessionTokens)}
        </span>
        {tokenBudget ? (
          <span className="text-fg-subtle/60">/ {formatTokens(tokenBudget)}</span>
        ) : null}
        {/* Mini progress arc */}
        {tokenBudget ? (
          <div className="h-1 w-10 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                over ? 'bg-red-400' : near ? 'bg-yellow-400' : 'bg-accent',
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : null}
      </button>

      {/* Budget edit — click token count area to toggle */}
      <button
        onClick={() => {
          setBudgetInput(tokenBudget ? formatTokens(tokenBudget) : '');
          setEditing(!editing);
        }}
        className="rounded p-1 text-fg-subtle/40 transition hover:bg-white/[0.04] hover:text-fg-subtle"
        title={tokenBudget ? `Budget: ${formatTokens(tokenBudget)} — click to edit` : 'Set token budget'}
      >
        <span className="text-[9px] font-medium">
          {editing ? '×' : tokenBudget ? '✎' : '+'}
        </span>
      </button>

      {/* Inline budget editor */}
      {editing && (
        <div
          className="absolute right-0 top-full z-20 mt-1 animate-fadeInUp rounded-xl border border-white/5 p-2"
          style={{
            background: 'rgba(17, 19, 23, 0.92)',
            backdropFilter: 'blur(16px)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4), inset 0 0 0 1px rgba(255, 255, 255, 0.04)',
          }}
        >
          <div className="mb-1.5 text-[10px] font-medium text-fg-subtle">Token Budget</div>
          <div className="flex items-center gap-1.5">
            <input
              ref={inputRef}
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveBudget();
                if (e.key === 'Escape') setEditing(false);
              }}
              placeholder="e.g. 50k"
              className="w-24 rounded-lg border border-border bg-white/[0.03] px-2.5 py-1.5 font-mono text-[12px] text-fg outline-none transition placeholder:text-fg-subtle/40 focus:border-accent/40"
            />
            <button
              onClick={() => void saveBudget()}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-accent transition hover:bg-accent/25"
              title="Save"
            >
              <Check size={12} />
            </button>
            {tokenBudget && (
              <button
                onClick={async () => {
                  setBudgetInput('');
                  try {
                    await setTokenBudget(sessionId, null);
                    setTokenBudgetLocal(undefined);
                    addToast('Budget removed', 'success');
                  } catch { /* ignore */ }
                  setEditing(false);
                }}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/10 text-red-400 transition hover:bg-red-500/20"
                title="Remove budget"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <div className="mt-1.5 text-[9px] text-fg-subtle/50">
            Accepts: 10000, 50k, 1.5M — empty to remove
          </div>
        </div>
      )}
    </div>
  );
}
