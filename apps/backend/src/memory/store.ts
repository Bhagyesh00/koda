import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { jaccardSimilarity } from '../agent/drift.js';
import { getPool, query } from '../db/client.js';
import { embed } from './embeddings.js';

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
    if (!getPool()) {
      this.loadFromFile();
    }
  }

  private loadFromFile(): void {
    try {
      if (fs.existsSync(MEMORY_FILE)) {
        const raw = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
        if (Array.isArray(raw)) this.entries = raw;
      }
    } catch (err) {
      logger.warn({ err }, 'failed to load memory store');
    }
  }

  private persistToFile(): void {
    try {
      fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
      const tmp = `${MEMORY_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.entries, null, 2));
      fs.renameSync(tmp, MEMORY_FILE);
    } catch (err) {
      logger.warn({ err }, 'failed to persist memory store');
    }
  }

  remember(sessionId: string, userText: string, assistantText: string): void {
    if (!userText.trim() || !assistantText.trim()) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ts = Date.now();

    if (getPool()) {
      // Async: embed + insert into pgvector
      embed(userText).then((embedding) => {
        const vec = embedding ? `[${embedding.join(',')}]` : null;
        return query(
          `INSERT INTO memory_entries (id, session_id, user_text, assistant_text, embedding, ts)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO NOTHING`,
          [id, sessionId, userText, assistantText, vec, ts],
        );
      }).catch((err) => logger.error({ err }, 'failed to save memory entry'));
    } else {
      this.entries.push({ id, sessionId, userText, assistantText, ts });
      if (this.entries.length > MAX_ENTRIES) this.entries = this.entries.slice(-MAX_ENTRIES);
      this.persistToFile();
    }
  }

  async recall(
    queryText: string,
    excludeSessionId: string,
    topK = 3,
  ): Promise<Array<{ sessionId: string; excerpt: string; score: number; ts: number }>> {
    if (getPool()) {
      return this.recallFromPostgres(queryText, excludeSessionId, topK);
    }
    return this.recallJaccard(queryText, excludeSessionId, topK);
  }

  private async recallFromPostgres(
    queryText: string,
    excludeSessionId: string,
    topK: number,
  ): Promise<Array<{ sessionId: string; excerpt: string; score: number; ts: number }>> {
    const embedding = await embed(queryText);
    if (!embedding) return this.recallJaccard(queryText, excludeSessionId, topK);

    const vec = `[${embedding.join(',')}]`;
    const result = await query<{
      session_id: string;
      user_text: string;
      assistant_text: string;
      ts: string;
      score: number;
    }>(
      `SELECT session_id, user_text, assistant_text, ts,
              1 - (embedding <=> $1::vector) AS score
       FROM memory_entries
       WHERE session_id != $2
         AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [vec, excludeSessionId, topK],
    );

    return result.rows
      .filter((r) => r.score >= RECALL_THRESHOLD)
      .map((r) => ({
        sessionId: r.session_id,
        excerpt: `Q: ${r.user_text.slice(0, 100)}\nA: ${r.assistant_text.slice(0, 150)}`,
        score: Number(r.score.toFixed(3)),
        ts: Number(r.ts),
      }));
  }

  private recallJaccard(
    queryText: string,
    excludeSessionId: string,
    topK: number,
  ): Array<{ sessionId: string; excerpt: string; score: number; ts: number }> {
    return this.entries
      .filter((e) => e.sessionId !== excludeSessionId)
      .map((e) => ({ entry: e, score: jaccardSimilarity(queryText, e.userText) }))
      .filter((s) => s.score >= RECALL_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((s) => ({
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
    if (getPool()) {
      query('DELETE FROM memory_entries WHERE id = $1', [id]).catch((err) =>
        logger.error({ err }, 'failed to delete memory entry'),
      );
    } else {
      this.entries = this.entries.filter((e) => e.id !== id);
      this.persistToFile();
    }
  }

  clear(): void {
    if (getPool()) {
      query('DELETE FROM memory_entries').catch((err) =>
        logger.error({ err }, 'failed to clear memory entries'),
      );
    } else {
      this.entries = [];
      this.persistToFile();
    }
  }
}

export const memoryStore = new MemoryStore();
