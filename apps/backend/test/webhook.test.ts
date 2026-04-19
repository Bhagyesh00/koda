import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from '../src/server.js';

const TOKEN = process.env.AUTH_TOKEN ?? 'dev-secret-change-me';
const app = createServer();
const auth = { Authorization: `Bearer ${TOKEN}` };

describe('POST /v1/webhook/run', () => {
  it('returns 400 when message is missing', async () => {
    const res = await request(app)
      .post('/v1/webhook/run')
      .set(auth)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message/i);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/v1/webhook/run')
      .send({ message: 'hello' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown sessionId', async () => {
    const res = await request(app)
      .post('/v1/webhook/run')
      .set(auth)
      .send({ message: 'test', sessionId: 'nonexistent-session-id' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('creates a new session when sessionId not provided', async () => {
    const res = await request(app)
      .post('/v1/webhook/run')
      .set(auth)
      .send({ message: 'say "pong"', timeoutMs: 30_000 });
    // Either completes or errors — but must have a sessionId
    expect([200, 500]).toContain(res.status);
    expect(res.body.sessionId).toBeTruthy();
  }, 35_000);

  it('accepts a valid existing sessionId', async () => {
    // Create session first
    const session = await request(app)
      .post('/v1/sessions')
      .set(auth)
      .send({ title: 'Webhook Session' });
    const sessionId = session.body.id as string;

    const res = await request(app)
      .post('/v1/webhook/run')
      .set(auth)
      .send({ message: 'say "pong"', sessionId, timeoutMs: 30_000 });
    expect([200, 500]).toContain(res.status);
    expect(res.body.sessionId).toBe(sessionId);
  }, 35_000);
});
