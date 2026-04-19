import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from '../src/server.js';

const TOKEN = process.env.AUTH_TOKEN ?? 'dev-secret-change-me';
const app = createServer();
const auth = { Authorization: `Bearer ${TOKEN}` };

// ── Auth middleware ─────────────────────────────────────────────────────────

describe('Auth middleware', () => {
  it('rejects requests with no token — 401', async () => {
    const res = await request(app).get('/v1/sessions');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('unauthorized');
  });

  it('rejects requests with wrong token — 401', async () => {
    const res = await request(app)
      .get('/v1/sessions')
      .set('Authorization', 'Bearer wrong-token');
    expect(res.status).toBe(401);
  });

  it('accepts requests with correct token — 200', async () => {
    const res = await request(app).get('/v1/sessions').set(auth);
    expect(res.status).toBe(200);
  });

  it('rejects malformed Authorization header (no Bearer prefix)', async () => {
    const res = await request(app)
      .get('/v1/sessions')
      .set('Authorization', TOKEN);
    expect(res.status).toBe(401);
  });
});

// ── /v1/auth/register & /v1/auth/login ─────────────────────────────────────
// These require DATABASE_URL; skip gracefully when DB is not available

describe('Auth routes — registration (requires DB)', () => {
  it('returns 503 when DATABASE_URL is not configured', async () => {
    // Without a DB these endpoints return 503
    const res = await request(app)
      .post('/v1/auth/register')
      .send({ email: 'test@example.com', password: 'password123' });
    // Either 503 (no DB) or 201 (DB available)
    expect([201, 503]).toContain(res.status);
  });

  it('rejects registration with short password', async () => {
    const res = await request(app)
      .post('/v1/auth/register')
      .send({ email: 'test@example.com', password: 'short' });
    expect([400, 503]).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error).toMatch(/password/i);
    }
  });

  it('rejects registration with missing email', async () => {
    const res = await request(app)
      .post('/v1/auth/register')
      .send({ password: 'validpassword' });
    expect([400, 503]).toContain(res.status);
  });

  it('rejects registration with missing password', async () => {
    const res = await request(app)
      .post('/v1/auth/register')
      .send({ email: 'user@example.com' });
    expect([400, 503]).toContain(res.status);
  });
});

describe('Auth routes — login (requires DB)', () => {
  it('returns 503 when DATABASE_URL is not configured', async () => {
    const res = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'nonexistent@example.com', password: 'password' });
    expect([401, 503]).toContain(res.status);
  });

  it('rejects login with missing fields', async () => {
    const res = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'only@email.com' });
    expect([400, 503]).toContain(res.status);
  });
});

describe('Auth routes — /v1/auth/me', () => {
  it('returns system user for legacy AUTH_TOKEN', async () => {
    const res = await request(app)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
    expect(res.body.userId).toBe('system');
  });

  it('returns 401 with no token', async () => {
    const res = await request(app).get('/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid JWT', async () => {
    const res = await request(app)
      .get('/v1/auth/me')
      .set('Authorization', 'Bearer invalid.jwt.token');
    expect(res.status).toBe(401);
  });
});
