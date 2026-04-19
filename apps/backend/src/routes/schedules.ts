import { Router } from 'express';
import cron from 'node-cron';
import { randomUUID } from 'node:crypto';
import type { ServerEvent } from '@koda/shared';
import { query, isPoolAvailable } from '../db/client.js';
import { sessionStore } from '../sessions/store.js';
import { runTurn } from '../agent/loop.js';
import { SSEWriter } from '../sse.js';
import { logger } from '../logger.js';

/** Discards all SSE events — used for fire-and-forget scheduled runs. */
class NoopSSE extends SSEWriter {
  constructor() {
    const fakeRes = { setHeader: () => {}, write: () => true, end: () => {}, flushHeaders: () => {} } as never;
    super(fakeRes);
  }
  override send(_event: ServerEvent): void {}
  override close(): void {}
}

export const schedulesRouter: Router = Router();

interface Schedule {
  id: string;
  name: string;
  cronExpr: string;
  message: string;
  sessionId?: string;
  workDir?: string;
  enabled: boolean;
  lastRun?: string;
  createdAt: string;
}

// In-memory fallback when no DB
const memSchedules = new Map<string, Schedule>();
const cronJobs = new Map<string, cron.ScheduledTask>();

function allSchedules(): Schedule[] {
  return [...memSchedules.values()];
}

function startCronJob(schedule: Schedule) {
  if (!schedule.enabled) return;
  if (!cron.validate(schedule.cronExpr)) {
    logger.warn({ cronExpr: schedule.cronExpr }, 'invalid cron expression, skipping schedule');
    return;
  }
  const task = cron.schedule(schedule.cronExpr, async () => {
    logger.info({ scheduleId: schedule.id, name: schedule.name }, 'running scheduled task');
    let sessionId = schedule.sessionId;
    if (!sessionId) {
      const s = sessionStore.create({ title: `Scheduled: ${schedule.name}`, cwd: schedule.workDir });
      sessionId = s.id;
    }
    try {
      await runTurn({ sessionId, userMessage: schedule.message, sse: new NoopSSE(), autoApproveAll: true });
      const updated = { ...schedule, lastRun: new Date().toISOString() };
      memSchedules.set(schedule.id, updated);
    } catch (err) {
      logger.error({ err, scheduleId: schedule.id }, 'scheduled task error');
    }
  });
  cronJobs.set(schedule.id, task);
}

// Load persisted schedules on startup
export async function loadSchedules(): Promise<void> {
  if (!isPoolAvailable()) return;
  try {
    const { rows } = await query<Schedule>('SELECT * FROM schedules WHERE enabled=true');
    for (const row of rows) {
      memSchedules.set(row.id, row);
      startCronJob(row);
    }
    logger.info({ count: rows.length }, 'schedules loaded');
  } catch (err) {
    logger.warn({ err }, 'failed to load schedules from DB');
  }
}

// GET /v1/schedules
schedulesRouter.get('/schedules', (_req, res) => {
  res.json({ schedules: allSchedules() });
});

// POST /v1/schedules
schedulesRouter.post('/schedules', async (req, res) => {
  const { name, cronExpr, message, sessionId, workDir } = req.body as Partial<Schedule>;
  if (!name || !cronExpr || !message) {
    res.status(400).json({ error: 'name, cronExpr, and message are required' });
    return;
  }
  if (!cron.validate(cronExpr)) {
    res.status(400).json({ error: `Invalid cron expression: ${cronExpr}` });
    return;
  }

  const schedule: Schedule = {
    id: randomUUID(),
    name,
    cronExpr,
    message,
    sessionId,
    workDir,
    enabled: true,
    createdAt: new Date().toISOString(),
  };

  memSchedules.set(schedule.id, schedule);
  startCronJob(schedule);

  if (isPoolAvailable()) {
    try {
      await query(
        'INSERT INTO schedules (id,name,cron_expr,message,session_id,work_dir,enabled,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [schedule.id, schedule.name, schedule.cronExpr, schedule.message, schedule.sessionId ?? null, schedule.workDir ?? null, true, schedule.createdAt],
      );
    } catch (err) {
      logger.warn({ err }, 'failed to persist schedule');
    }
  }

  res.status(201).json(schedule);
});

// PATCH /v1/schedules/:id — enable/disable
schedulesRouter.patch('/schedules/:id', async (req, res) => {
  const { id } = req.params;
  const schedule = memSchedules.get(id!);
  if (!schedule) {
    res.status(404).json({ error: 'Schedule not found' });
    return;
  }
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled === 'boolean') {
    schedule.enabled = enabled;
    if (!enabled) {
      cronJobs.get(id!)?.stop();
      cronJobs.delete(id!);
    } else {
      startCronJob(schedule);
    }
    memSchedules.set(id!, schedule);
    if (isPoolAvailable()) {
      await query('UPDATE schedules SET enabled=$1 WHERE id=$2', [enabled, id]).catch(() => {});
    }
  }
  res.json(schedule);
});

// DELETE /v1/schedules/:id
schedulesRouter.delete('/schedules/:id', async (req, res) => {
  const { id } = req.params;
  if (!memSchedules.has(id!)) {
    res.status(404).json({ error: 'Schedule not found' });
    return;
  }
  cronJobs.get(id!)?.stop();
  cronJobs.delete(id!);
  memSchedules.delete(id!);
  if (isPoolAvailable()) {
    await query('DELETE FROM schedules WHERE id=$1', [id]).catch(() => {});
  }
  res.status(204).end();
});

// POST /v1/schedules/:id/run — manual trigger
schedulesRouter.post('/schedules/:id/run', async (req, res) => {
  const { id } = req.params;
  const schedule = memSchedules.get(id!);
  if (!schedule) {
    res.status(404).json({ error: 'Schedule not found' });
    return;
  }
  const session = sessionStore.create({ title: `Manual: ${schedule.name}`, cwd: schedule.workDir });
  runTurn({ sessionId: session.id, userMessage: schedule.message, sse: new NoopSSE(), autoApproveAll: true })
    .catch((err) => logger.error({ err }, 'manual schedule run error'));
  res.json({ sessionId: session.id, status: 'started' });
});
