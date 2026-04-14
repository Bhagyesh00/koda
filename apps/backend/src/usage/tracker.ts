import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

interface UsageEntry {
  ts: number;          // Unix timestamp ms
  sessionId: string;
  tokens: number;      // tokens consumed this turn
  elapsedMs: number;   // time for this turn
}

interface UsageData {
  entries: UsageEntry[];
  totalTokens: number;
}

const USAGE_FILE = path.join(config.WORK_DIR_ABS, '.koda', 'usage.json');

class UsageTracker {
  private data: UsageData = { entries: [], totalTokens: 0 };

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(USAGE_FILE)) {
        const raw = fs.readFileSync(USAGE_FILE, 'utf8');
        this.data = JSON.parse(raw) as UsageData;
      }
    } catch {
      this.data = { entries: [], totalTokens: 0 };
    }
  }

  private persist(): void {
    const dir = path.dirname(USAGE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(USAGE_FILE, JSON.stringify(this.data), 'utf8');
  }

  /** Record tokens consumed during a single LLM turn. */
  record(sessionId: string, tokens: number, elapsedMs: number): void {
    this.data.entries.push({ ts: Date.now(), sessionId, tokens, elapsedMs });
    this.data.totalTokens += tokens;
    this.persist();
  }

  /** Get usage entries within a time range. */
  query(from: number, to: number): UsageEntry[] {
    return this.data.entries.filter((e) => e.ts >= from && e.ts <= to);
  }

  /** Get aggregate stats for a time range. */
  aggregate(from: number, to: number): {
    totalTokens: number;
    totalTurns: number;
    totalTimeMs: number;
    bySession: Record<string, { tokens: number; turns: number }>;
    byDay: Array<{ date: string; tokens: number; turns: number }>;
  } {
    const entries = this.query(from, to);
    let totalTokens = 0;
    let totalTimeMs = 0;
    const bySession: Record<string, { tokens: number; turns: number }> = {};
    const dayMap = new Map<string, { tokens: number; turns: number }>();

    for (const e of entries) {
      totalTokens += e.tokens;
      totalTimeMs += e.elapsedMs;

      // Per-session
      if (!bySession[e.sessionId]) bySession[e.sessionId] = { tokens: 0, turns: 0 };
      bySession[e.sessionId]!.tokens += e.tokens;
      bySession[e.sessionId]!.turns += 1;

      // Per-day
      const day = new Date(e.ts).toISOString().slice(0, 10); // YYYY-MM-DD
      const existing = dayMap.get(day) ?? { tokens: 0, turns: 0 };
      existing.tokens += e.tokens;
      existing.turns += 1;
      dayMap.set(day, existing);
    }

    // Sort days chronologically
    const byDay = Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({ date, ...data }));

    return { totalTokens, totalTurns: entries.length, totalTimeMs, bySession, byDay };
  }

  /** Get all-time total tokens. */
  get totalTokens(): number {
    return this.data.totalTokens;
  }

  /** Get all-time total turns. */
  get totalTurns(): number {
    return this.data.entries.length;
  }
}

export const usageTracker = new UsageTracker();
