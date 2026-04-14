import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { Session, ChatMessage, SessionMode, Todo, GuardRule } from '@koda/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { clearShellCwd } from '../sandbox/shellState.js';

const SESSIONS_DIR = path.join(config.WORK_DIR_ABS, '.koda', 'sessions');

class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor() {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    for (const f of fs.readdirSync(SESSIONS_DIR)) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8');
        const s = JSON.parse(raw) as Session;
        // Backfill fields added after first persist
        if (!s.mode) s.mode = 'build';
        if (!Array.isArray(s.messages)) s.messages = [];
        if (!Array.isArray(s.todos)) s.todos = [];
        if (!Array.isArray(s.guardrails)) s.guardrails = [];
        if (!Array.isArray(s.contextReads)) s.contextReads = [];
        if (!Array.isArray(s.hypotheses)) s.hypotheses = [];
        if (!Array.isArray(s.snapshots)) s.snapshots = [];
        if (typeof s.tokensUsed !== 'number') s.tokensUsed = 0;
        if (!Array.isArray(s.editHistory)) s.editHistory = [];
        if (!s.mentalModel) s.mentalModel = { nodes: [], edges: [] };
        this.sessions.set(s.id, s);
      } catch (err) {
        logger.warn({ err, file: f }, 'failed to load session');
      }
    }
    logger.info({ count: this.sessions.size, dir: SESSIONS_DIR }, 'sessions loaded');
  }

  private persist(s: Session): void {
    const dest = path.join(SESSIONS_DIR, `${s.id}.json`);
    const tmp = `${dest}.tmp`;
    try {
      // Write to a temp file then atomically rename so a crash mid-write
      // never leaves a truncated/corrupt session file on disk.
      fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
      fs.renameSync(tmp, dest);
    } catch (err) {
      logger.error({ err, sessionId: s.id }, 'failed to persist session');
      try { fs.unlinkSync(tmp); } catch { /* temp file may not exist */ }
    }
  }

  create(opts: { title?: string; cwd?: string; parentId?: string; branchPoint?: number } = {}): Session {
    const now = Date.now();
    // Default title to the folder basename so sessions are identifiable at a glance
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
      if (!s.contextReads.includes(f)) {
        s.contextReads.push(f);
        changed = true;
      }
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

  // ── Phase 28 — Cost tracking ───────────────────────────────────────────
  addTokens(id: string, tokens: number): number {
    const s = this.sessions.get(id);
    if (!s) return 0;
    s.tokensUsed = (s.tokensUsed ?? 0) + tokens;
    this.persist(s);
    return s.tokensUsed;
  }

  setTokenBudget(id: string, budget: number | undefined): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.tokenBudget = budget;
    this.persist(s);
  }

  // ── Phase 23 — Intent Freeze ──────────────────────────────────────────
  setPinnedIntent(id: string, intent: string | undefined): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.pinnedIntent = intent;
    this.persist(s);
  }

  // ── Phase 26 — Regret Journal ─────────────────────────────────────────
  recordEdit(id: string, entry: { path: string; ts: number; contentHash: string }): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.editHistory = s.editHistory ?? [];
    s.editHistory.push({ ...entry, reverted: false });
    // Keep last 200 edits
    if (s.editHistory.length > 200) {
      s.editHistory = s.editHistory.slice(-200);
    }
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

  // ── Sprint 2 — Model switching / clear / compact ──────────────────────
  setModel(id: string, model: string | undefined): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.model = model;
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

  /** Keep only the last `keepLast` messages to reduce context size. */
  compactMessages(id: string, keepLast = 20): void {
    const s = this.sessions.get(id);
    if (!s) return;
    if (s.messages.length > keepLast) {
      s.messages = s.messages.slice(-keepLast);
    }
    s.updatedAt = Date.now();
    this.persist(s);
  }

  // ── Phase 30 — Mental Model ────────────────────────────────────────────
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
      try {
        fs.unlinkSync(path.join(SESSIONS_DIR, `${id}.json`));
      } catch {
        /* file may not exist yet */
      }
    }
    return existed;
  }
}

export const sessionStore = new SessionStore();
