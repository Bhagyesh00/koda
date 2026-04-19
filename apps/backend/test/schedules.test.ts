import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from '../src/server.js';

const TOKEN = process.env.AUTH_TOKEN ?? 'dev-secret-change-me';
const app = createServer();
const auth = { Authorization: `Bearer ${TOKEN}` };

// ── GET /v1/schedules ─────────────────────────────────────────────────────────

describe('GET /v1/schedules', () => {
  it('returns an empty schedules array initially', async () => {
    const res = await request(app).get('/v1/schedules').set(auth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.schedules)).toBe(true);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/v1/schedules');
    expect(res.status).toBe(401);
  });
});

// ── POST /v1/schedules ────────────────────────────────────────────────────────

describe('POST /v1/schedules', () => {
  it('creates a schedule with valid cron expression', async () => {
    const res = await request(app)
      .post('/v1/schedules')
      .set(auth)
      .send({
        name: 'Daily Standup',
        cronExpr: '0 9 * * 1-5',
        message: 'Run daily health check',
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe('Daily Standup');
    expect(res.body.cronExpr).toBe('0 9 * * 1-5');
    expect(res.body.enabled).toBe(true);
  });

  it('creates a schedule with hourly cron', async () => {
    const res = await request(app)
      .post('/v1/schedules')
      .set(auth)
      .send({ name: 'Hourly', cronExpr: '0 * * * *', message: 'Check metrics' });
    expect(res.status).toBe(201);
  });

  it('rejects invalid cron expression', async () => {
    const res = await request(app)
      .post('/v1/schedules')
      .set(auth)
      .send({ name: 'Bad', cronExpr: 'not-a-cron', message: 'test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cron/i);
  });

  it('rejects missing name', async () => {
    const res = await request(app)
      .post('/v1/schedules')
      .set(auth)
      .send({ cronExpr: '* * * * *', message: 'test' });
    expect(res.status).toBe(400);
  });

  it('rejects missing message', async () => {
    const res = await request(app)
      .post('/v1/schedules')
      .set(auth)
      .send({ name: 'Test', cronExpr: '* * * * *' });
    expect(res.status).toBe(400);
  });

  it('rejects missing cronExpr', async () => {
    const res = await request(app)
      .post('/v1/schedules')
      .set(auth)
      .send({ name: 'Test', message: 'do something' });
    expect(res.status).toBe(400);
  });
});

// ── PATCH + DELETE /v1/schedules/:id ─────────────────────────────────────────

describe('PATCH /v1/schedules/:id', () => {
  it('disables a schedule', async () => {
    const create = await request(app)
      .post('/v1/schedules')
      .set(auth)
      .send({ name: 'Toggle Me', cronExpr: '* * * * *', message: 'ping' });
    const id = create.body.id as string;

    const patch = await request(app)
      .patch(`/v1/schedules/${id}`)
      .set(auth)
      .send({ enabled: false });
    expect(patch.status).toBe(200);
    expect(patch.body.enabled).toBe(false);
  });

  it('re-enables a disabled schedule', async () => {
    const create = await request(app)
      .post('/v1/schedules')
      .set(auth)
      .send({ name: 'Re-enable', cronExpr: '* * * * *', message: 'check' });
    const id = create.body.id as string;

    await request(app).patch(`/v1/schedules/${id}`).set(auth).send({ enabled: false });
    const res = await request(app)
      .patch(`/v1/schedules/${id}`)
      .set(auth)
      .send({ enabled: true });
    expect(res.body.enabled).toBe(true);
  });

  it('returns 404 for unknown schedule id', async () => {
    const res = await request(app)
      .patch('/v1/schedules/unknown-id')
      .set(auth)
      .send({ enabled: false });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /v1/schedules/:id', () => {
  it('deletes a schedule and returns 204', async () => {
    const create = await request(app)
      .post('/v1/schedules')
      .set(auth)
      .send({ name: 'Delete Me', cronExpr: '* * * * *', message: 'bye' });
    const id = create.body.id as string;

    const del = await request(app).delete(`/v1/schedules/${id}`).set(auth);
    expect(del.status).toBe(204);

    // Should no longer appear in list
    const list = await request(app).get('/v1/schedules').set(auth);
    const ids = (list.body.schedules as Array<{ id: string }>).map((s) => s.id);
    expect(ids).not.toContain(id);
  });

  it('returns 404 for unknown schedule id', async () => {
    const res = await request(app).delete('/v1/schedules/nonexistent').set(auth);
    expect(res.status).toBe(404);
  });
});

// ── POST /v1/schedules/:id/run ───────────────────────────────────────────────

describe('POST /v1/schedules/:id/run', () => {
  it('triggers a schedule run and returns sessionId', async () => {
    const create = await request(app)
      .post('/v1/schedules')
      .set(auth)
      .send({ name: 'Manual Run', cronExpr: '0 0 * * *', message: 'do work' });
    const id = create.body.id as string;

    const res = await request(app)
      .post(`/v1/schedules/${id}/run`)
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeTruthy();
    expect(res.body.status).toBe('started');
  });

  it('returns 404 for unknown schedule', async () => {
    const res = await request(app)
      .post('/v1/schedules/nonexistent/run')
      .set(auth);
    expect(res.status).toBe(404);
  });
});
