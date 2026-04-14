'use client';

import { useState } from 'react';
import { Coins, Settings } from 'lucide-react';
import { useChatStore } from '@/lib/store';
import { setTokenBudget } from '@/lib/api';
import { cn } from '@/lib/cn';

interface Props {
  sessionId: string | null;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

export function CostMeter({ sessionId }: Props) {
  const sessionTokens = useChatStore((s) => s.sessionTokens);
  const tokenBudget = useChatStore((s) => s.tokenBudget);
  const setTokenBudgetLocal = useChatStore((s) => s.setTokenBudgetLocal);
  const addToast = useChatStore((s) => s.addToast);
  const [editing, setEditing] = useState(false);
  const [budgetInput, setBudgetInput] = useState(String(tokenBudget ?? ''));

  const pct = tokenBudget ? Math.min(100, (sessionTokens / tokenBudget) * 100) : 0;
  const near = pct >= 80 && pct < 100;
  const over = pct >= 100;

  async function saveBudget() {
    if (!sessionId) return;
    const n = budgetInput ? parseInt(budgetInput, 10) : null;
    if (n !== null && (isNaN(n) || n <= 0)) return;
    try {
      await setTokenBudget(sessionId, n);
      setTokenBudgetLocal(n ?? undefined);
      addToast(n ? `Budget set to ${formatTokens(n)} tokens` : 'Budget removed', 'success');
    } catch (e) {
      addToast((e as Error).message, 'error');
    }
    setEditing(false);
  }

  if (!sessionId) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
      <Coins size={11} className={cn(over ? 'text-red-400' : near ? 'text-yellow-400' : 'text-fg-subtle')} />
      <span className="font-mono text-fg-muted">
        {formatTokens(sessionTokens)}
        {tokenBudget && <span className="text-fg-subtle"> / {formatTokens(tokenBudget)}</span>}
      </span>
      {tokenBudget && (
        <div className="h-1 w-16 overflow-hidden rounded-full bg-bg-hover">
          <div
            className={cn(
              'h-full transition-all',
              over ? 'bg-red-400' : near ? 'bg-yellow-400' : 'bg-accent',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {editing ? (
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveBudget();
              if (e.key === 'Escape') setEditing(false);
            }}
            onBlur={() => void saveBudget()}
            autoFocus
            placeholder="tokens"
            className="w-20 rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] text-fg outline-none focus:border-accent"
          />
        </div>
      ) : (
        <button
          onClick={() => { setBudgetInput(String(tokenBudget ?? '')); setEditing(true); }}
          className="text-fg-subtle hover:text-fg"
          title="Set token budget"
        >
          <Settings size={10} />
        </button>
      )}
    </div>
  );
}
