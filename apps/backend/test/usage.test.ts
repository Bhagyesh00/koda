import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from '../src/server.js';

const TOKEN = process.env.AUTH_TOKEN ?? 'dev-secret-change-me';
const app = createServer();
const auth = { Authorization: `Bearer ${TOKEN}` };

describe('GET /v1/usage', () => {
  it('returns usage stats with required fields', async () => {
    const res = await request(app).get('/v1/usage').set(auth);
    expect(res.status).toBe(200);
    expect(typeof res.body.totalTokens).toBe('number');
    expect(typeof res.body.bySession).toBe('object');
    expect(Array.isArray(res.body.byDay)).toBe(true);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/v1/usage');
    expect(res.status).toBe(401);
  });
});

describe('GET /v1/usage/summary', () => {
  it('returns summary stats', async () => {
    const res = await request(app).get('/v1/usage/summary').set(auth);
    expect(res.status).toBe(200);
    expect(typeof res.body.today).toBe('object');
    expect(typeof res.body.week).toBe('object');
    expect(typeof res.body.month).toBe('object');
    expect(typeof res.body.allTime).toBe('object');
    expect(typeof res.body.allTime.totalTokens).toBe('number');
    expect(res.body.allTime.totalTokens).toBeGreaterThanOrEqual(0);
  });
});
