import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { Session, ChatMessage, SessionMode, Todo, GuardRule } from '@koda/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { clearShellCwd } from '../sandbox/shellState.js';
import { getPool, query } from '../db/client.js';
import { stopWatchingForSession } from '../watch/watcher.js';

const SESSIONS_DIR = path.join(config.WORK_DIR_ABS, '.koda', 'sessions');

function backfill(s: Session): Session {
  if (!s.mode) s.mode = 'build';
  if (!Array.isArray(s.messages)) s.messages = [];
  if (!Array.isArray(s.todos)) s.todos = [];
  if (!Array.isArray(s.guardrails)) s.guardrails = [];
  if (!Array.isArray(s.contextReads)) s.contextReads = [];
  if (!Array.isArray(s.hypotheses)) s.hypotheses = [];
  if (!Array.isArray(s.snapshots)) s.snapshots = [];
  if (typeof s.tokensUsed !== 'number') s.tokensUsed = 0;
  if (!Array.isArray(s.editHistory)) s.editHistory = [];
  if (!Array.isArray(s.proofs)) s.proofs = [];
  if (!Array.isArray(s.constraints)) s.constraints = [];
  if (!Array.isArray(s.checkpoints)) s.checkpoints = [];
  if (!Array.isArray(s.rejections)) s.rejections = [];
  if (!s.mentalModel) s.mentalModel = { nodes: [], edges: [] };
  return s;
}

/**
 * Per-session async persist coordinator.
 *
 * Coalesces bursts (3 rapid appendMessage calls → 1 or 2 disk writes that always
 * include the latest state) and serialises writes per session so a slow disk
 * never produces out-of-order state on disk. Failures are logged; errors no
 * longer get swallowed by an unawaited .catch() like before.
 */
interface PersistState {
  running: boolean;
  dirty: boolean;
  tail: Promise<void>;
}

class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly persistState = new Map<string, PersistState>();

  /** Must be called once at startup before the HTTP server begins accepting requests. */
  async initialize(): Promise<void> {
    if (getPool()) {
      await this.loadFromPostgres();
    } else {
      this.loadFromFiles();
    }
  }

  private async loadFromPostgres(): Promise<void> {
    const result = await query<{ data: Session }>('SELECT data FROM sessions ORDER BY updated_at DESC');
    for (const row of result.rows) {
      const s = backfill(row.data);
      this.sessions.set(s.id, s);
    }
    logger.info({ count: this.sessions.size }, 'sessions loaded from postgres');
  }

  private loadFromFiles(): void {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    for (const f of fs.readdirSync(SESSIONS_DIR)) {
      if (!f.endsWith('.json')) continue;
      try {
        const s = backfill(JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8')) as Session);
        this.sessions.set(s.id, s);
      } catch (err) {
        logger.warn({ err, file: f }, 'failed to load session');
      }
    }
    logger.info({ count: this.sessions.size, dir: SESSIONS_DIR }, 'sessions loaded from files');
  }

  private persist(s: Session): void {
    let state = this.persistState.get(s.id);
    if (!state) {
      state = { running: false, dirty: false, tail: Promise.resolve() };
      this.persistState.set(s.id, state);
    }
    // If a write is in flight, just mark dirty — runPersistLoop will pick up the
    // latest in-memory state on its next iteration (coalescing).
    if (state.running) {
      state.dirty = true;
      return;
    }
    state.running = true;
    state.tail = state.tail.then(() => this.runPersistLoop(s.id));
  }

  private async runPersistLoop(id: string): Promise<void> {
    const state = this.persistState.get(id);
    if (!state) return;
    try {
      do {
        state.dirty = false;
        // Skip writes for a session that was deleted while we were queued —
        // otherwise a stale persist would resurrect it on disk.
        const live = this.sessions.get(id);
        if (!live) return;
        try {
          await this.doPersist(live);
        } catch (err) {
          logger.error({ err, sessionId: id }, 'session persist failed');
        }
      } while (state.dirty);
    } finally {
      state.running = false;
    }
  }

  private async doPersist(s: Session): Promise<void> {
    if (getPool()) {
      await query(
        `INSERT INTO sessions (id, data, created_at, updated_at)
         VALUES ($1, $2, to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0))
         ON CONFLICT (id) DO UPDATE
           SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
        [s.id, JSON.stringify(s), s.createdAt, s.updatedAt],
      );
      return;
    }
    const dest = path.join(SESSIONS_DIR, `${s.id}.json`);
    const tmp = `${dest}.tmp.${process.pid}.${Date.now()}`;
    try {
      // Ensure parent exists. Pre-fix this only worked when leaked test data
      // had already created the dir; with an isolated tmp WORK_DIR the first
      // write to a fresh workspace would ENOENT.
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
      fs.renameSync(tmp, dest);
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      throw err;
    }
  }

  /**
   * Wait for queued persists to complete. Pass a session id to wait for one,
   * omit to wait for all. Use on shutdown or in tests that need durability.
   */
  async flush(id?: string): Promise<void> {
    if (id !== undefined) {
      const state = this.persistState.get(id);
      if (state) await state.tail;
      return;
    }
    await Promise.allSettled(Array.from(this.persistState.values()).map((s) => s.tail));
  }

  create(opts: { title?: string; cwd?: string; parentId?: string; branchPoint?: number } = {}): Session {
    const now = Date.now();
    const defaultTitle = opts.cwd ? (path.basename(opts.cwd) || 'New chat') : 'New chat';
    const session: Session = {
      id: nanoid(10),
      title: opts.title ?? defaultTitle,
      createdAt: now,
      updatedAt: now,
      messages: [],
      todos: [],
      mode: 'build',
      cwd: opts.cwd,
      guardrails: [],
      contextReads: [],
      hypotheses: [],
      snapshots: [],
      parentId: opts.parentId,
      branchPoint: opts.branchPoint,
      tokensUsed: 0,
      editHistory: [],
      proofs: [],
      constraints: [],
      checkpoints: [],
      rejections: [],
      mentalModel: { nodes: [], edges: [] },
    };
    this.sessions.set(session.id, session);
    this.persist(session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): Session[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  update(session: Session): void {
    session.updatedAt = Date.now();
    this.sessions.set(session.id, session);
    this.persist(session);
  }

  appendMessage(id: string, msg: ChatMessage): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.messages.push(msg);
    s.updatedAt = Date.now();
    this.persist(s);
  }

  setMode(id: string, mode: SessionMode): Session | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    s.mode = mode;
    s.updatedAt = Date.now();
    this.persist(s);
    return s;
  }

  setTodos(id: string, todos: Todo[]): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.todos = todos;
    s.updatedAt = Date.now();
    this.persist(s);
  }

  setTitle(id: string, title: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.title = title;
    s.updatedAt = Date.now();
    this.persist(s);
  }

  setCwd(id: string, cwd: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.cwd = cwd;
    s.updatedAt = Date.now();
    this.persist(s);
  }

  setGuardrails(id: string, guardrails: GuardRule[]): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.guardrails = guardrails;
    s.updatedAt = Date.now();
    this.persist(s);
  }

  addContextReads(id: string, files: string[]): void {
    const s = this.sessions.get(id);
    if (!s) return;
    let changed = false;
    for (const f of files) {
      if (!s.contextReads.includes(f)) { s.contextReads.push(f); changed = true; }
    }
    if (changed) this.persist(s);
  }

  addSnapshot(id: string, snapshot: { ref: string; description: string; ts: number }): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.snapshots.push(snapshot);
    s.updatedAt = Date.now();
    this.persist(s);
  }

  addProof(id: string, proof: Session['proofs'][number]): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.proofs.push(proof);
    this.persist(s);
  }

  // ── Phase 31: constraint / checkpoint / rejection / perf / refactor-tx ──

  addConstraint(id: string, c: Session['constraints'][number]): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.constraints = s.constraints ?? [];
    s.constraints.push(c);
    this.persist(s);
  }

  removeConstraint(id: string, constraintId: string): boolean {
    const s = this.sessions.get(id);
    if (!s || !s.constraints) return false;
    const before = s.constraints.length;
    s.constraints = s.constraints.filter((c) => c.id !== constraintId);
    if (s.constraints.length === before) return false;
    this.persist(s);
    return true;
  }

  addCheckpoint(id: string, cp: Session['checkpoints'][number]): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.checkpoints = s.checkpoints ?? [];
    s.checkpoints.push(cp);
    if (s.checkpoints.length > 50) s.checkpoints = s.checkpoints.slice(-50);
    this.persist(s);
  }

  addRejection(id: string, r: Session['rejections'][number]): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.rejections = s.rejections ?? [];
    s.rejections.push(r);
    if (s.rejections.length > 100) s.rejections = s.rejections.slice(-100);
    this.persist(s);
  }

  setPerformanceBudget(id: string, budget: Session['performanceBudget']): void {
    const s = this.sessions.get(id);
    if (!s) return;
    if (budget == null) delete s.performanceBudget;
    else s.performanceBudget = budget;
    this.persist(s);
  }

  setRefactorTx(id: string, tx: Session['refactorTx']): void {
    const s = this.sessions.get(id);
    if (!s) return;
    if (tx == null) delete s.refactorTx;
    else s.refactorTx = tx;
    this.persist(s);
  }

  addHypothesis(id: string, hypothesis: Session['hypotheses'][number]): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.hypotheses.push(hypothesis);
    s.updatedAt = Date.now();
    this.persist(s);
  }

  updateHypothesis(id: string, hypothesisId: string, result: 'confirmed' | 'refuted', actualOutcome: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    const h = s.hypotheses.find((h) => h.id === hypothesisId);
    if (!h) return;
    h.result = result;
    h.actualOutcome = actualOutcome;
    s.updatedAt = Date.now();
    this.persist(s);
  }

  addTokens(id: string, tokens: number): number {
    const s = this.sessions.get(id);
    if (!s) return 0;
    s.tokensUsed = (s.tokensUsed ?? 0) + tokens;
    this.persist(s);
    return s.tokensUsed;
  }

  setTokenBudget(id: string, budget: number | null | undefined): void {
    const s = this.sessions.get(id);
    if (!s) return;
    if (budget == null) {
      delete s.tokenBudget;
    } else {
      s.tokenBudget = budget;
    }
    this.persist(s);
  }

  setPinnedIntent(id: string, intent: string | undefined): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.pinnedIntent = intent;
    this.persist(s);
  }

  recordEdit(id: string, entry: { path: string; ts: number; contentHash: string }): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.editHistory = s.editHistory ?? [];
    s.editHistory.push({ ...entry, reverted: false });
    if (s.editHistory.length > 200) s.editHistory = s.editHistory.slice(-200);
    this.persist(s);
  }

  markEditsReverted(id: string, path: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    for (const e of s.editHistory ?? []) {
      if (e.path === path) e.reverted = true;
    }
    this.persist(s);
  }

  setModel(id: string, model: string | undefined): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.model = model;
    s.updatedAt = Date.now();
    this.persist(s);
  }

  setSkill(id: string, skill: string | undefined): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.skill = skill;
    s.updatedAt = Date.now();
    this.persist(s);
  }

  clearMessages(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.messages = [];
    s.updatedAt = Date.now();
    this.persist(s);
  }

  compactMessages(id: string, keepLast = 20): void {
    const s = this.sessions.get(id);
    if (!s) return;
    if (s.messages.length > keepLast) s.messages = s.messages.slice(-keepLast);
    s.updatedAt = Date.now();
    this.persist(s);
  }

  updateMentalModel(id: string, fn: (model: NonNullable<Session['mentalModel']>) => void): void {
    const s = this.sessions.get(id);
    if (!s) return;
    if (!s.mentalModel) s.mentalModel = { nodes: [], edges: [] };
    fn(s.mentalModel);
    this.persist(s);
  }

  delete(id: string): boolean {
    const existed = this.sessions.delete(id);
    if (existed) {
      clearShellCwd(id);
      stopWatchingForSession(id);
      // Drop pending persists; runPersistLoop's `this.sessions.has(id)` guard
      // makes any in-flight iteration a no-op even if it's already running.
      this.persistState.delete(id);
      if (getPool()) {
        query('DELETE FROM sessions WHERE id = $1', [id]).catch((err) =>
          logger.error({ err, id }, 'failed to delete session from postgres'),
        );
      } else {
        try { fs.unlinkSync(path.join(SESSIONS_DIR, `${id}.json`)); } catch { /* ignore */ }
      }
    }
    return existed;
  }
}

export const sessionStore = new SessionStore();
