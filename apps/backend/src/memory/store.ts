/**
 * Cross-session semantic memory using keyword similarity (Jaccard).
 * Persists to `<WORK_DIR>/.koda/memory.json`. Indexes user → assistant
 * exchanges and retrieves top-K similar matches when a new user message
 * arrives.
 *
 * Not using embeddings to keep zero deps — Jaccard is fast, local, and
 * catches the obvious "I've seen this exact problem" case.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { jaccardSimilarity } from '../agent/drift.js';

interface MemoryEntry {
  id: string;
  sessionId: string;
  userText: string;
  assistantText: string;
  ts: number;
}

const MEMORY_FILE = path.join(config.WORK_DIR_ABS, '.koda', 'memory.json');
const RECALL_THRESHOLD = 0.15;
const MAX_ENTRIES = 500;

class MemoryStore {
  private entries: MemoryEntry[] = [];

  constructor() {
    try {
      if (fs.existsSync(MEMORY_FILE)) {
        const raw = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
        if (Array.isArray(raw)) this.entries = raw;
      }
    } catch (err) {
      logger.warn({ err }, 'failed to load memory store');
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
      // Atomic write: tmp → rename so a crash mid-write never corrupts the file.
      const tmp = `${MEMORY_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.entries, null, 2));
      fs.renameSync(tmp, MEMORY_FILE);
    } catch (err) {
      logger.warn({ err }, 'failed to persist memory store');
    }
  }

  remember(sessionId: string, userText: string, assistantText: string): void {
    if (!userText.trim() || !assistantText.trim()) return;
    this.entries.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      userText,
      assistantText,
      ts: Date.now(),
    });
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
    this.persist();
  }

  /**
   * Recall top-K entries similar to the query, excluding entries from the
   * current session (we want cross-session recall only).
   */
  recall(query: string, excludeSessionId: string, topK = 3): Array<{ sessionId: string; excerpt: string; score: number; ts: number }> {
    const scored = this.entries
      .filter((e) => e.sessionId !== excludeSessionId)
      .map((e) => ({
        entry: e,
        score: jaccardSimilarity(query, e.userText),
      }))
      .filter((s) => s.score >= RECALL_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored.map((s) => ({
      sessionId: s.entry.sessionId,
      excerpt: `Q: ${s.entry.userText.slice(0, 100)}\nA: ${s.entry.assistantText.slice(0, 150)}`,
      score: Number(s.score.toFixed(3)),
      ts: s.entry.ts,
    }));
  }

  list(): MemoryEntry[] {
    return [...this.entries].reverse();
  }

  delete(id: string): void {
    this.entries = this.entries.filter((e) => e.id !== id);
    this.persist();
  }

  clear(): void {
    this.entries = [];
    this.persist();
  }
}

export const memoryStore = new MemoryStore();
