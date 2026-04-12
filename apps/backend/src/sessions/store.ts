import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { Session, ChatMessage, SessionMode, Todo } from '@koda/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';

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
        this.sessions.set(s.id, s);
      } catch (err) {
        logger.warn({ err, file: f }, 'failed to load session');
      }
    }
    logger.info({ count: this.sessions.size, dir: SESSIONS_DIR }, 'sessions loaded');
  }

  private persist(s: Session): void {
    try {
      fs.writeFileSync(path.join(SESSIONS_DIR, `${s.id}.json`), JSON.stringify(s, null, 2));
    } catch (err) {
      logger.error({ err, sessionId: s.id }, 'failed to persist session');
    }
  }

  create(opts: { title?: string; cwd?: string } = {}): Session {
    const now = Date.now();
    const session: Session = {
      id: nanoid(10),
      title: opts.title ?? 'New chat',
      createdAt: now,
      updatedAt: now,
      messages: [],
      todos: [],
      mode: 'build',
      cwd: opts.cwd,
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

  delete(id: string): boolean {
    const existed = this.sessions.delete(id);
    if (existed) {
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
