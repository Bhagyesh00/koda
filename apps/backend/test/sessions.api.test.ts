import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from '../src/server.js';

const TOKEN = process.env.AUTH_TOKEN ?? 'dev-secret-change-me';
const app = createServer();
const auth = { Authorization: `Bearer ${TOKEN}` };

// ── GET /v1/sessions ─────────────────────────────────────────────────────────

describe('GET /v1/sessions', () => {
  it('returns an array of sessions', async () => {
    const res = await request(app).get('/v1/sessions').set(auth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.sessions)).toBe(true);
  });
});

// ── POST /v1/sessions ─────────────────────────────────────────────────────────

describe('POST /v1/sessions', () => {
  it('creates a session with title', async () => {
    const res = await request(app)
      .post('/v1/sessions')
      .set(auth)
      .send({ title: 'QA Test Session' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.title).toBe('QA Test Session');
    expect(res.body.messages).toEqual([]);
    expect(res.body.mode).toBe('build');
  });

  it('creates a session without title (auto-generates)', async () => {
    const res = await request(app).post('/v1/sessions').set(auth).send({});
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(typeof res.body.title).toBe('string');
  });

  it('rejects without auth token', async () => {
    const res = await request(app).post('/v1/sessions').send({ title: 'No Auth' });
    expect(res.status).toBe(401);
  });
});

// ── GET /v1/sessions/:id ─────────────────────────────────────────────────────

describe('GET /v1/sessions/:id', () => {
  it('returns the session by id', async () => {
    const create = await request(app)
      .post('/v1/sessions')
      .set(auth)
      .send({ title: 'Find Me' });
    const id = create.body.id as string;

    const res = await request(app).get(`/v1/sessions/${id}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.title).toBe('Find Me');
  });

  it('returns 404 for unknown session id', async () => {
    const res = await request(app).get('/v1/sessions/does-not-exist').set(auth);
    expect(res.status).toBe(404);
  });
});

// ── PATCH /v1/sessions/:id ───────────────────────────────────────────────────

describe('PATCH /v1/sessions/:id (rename)', () => {
  it('updates session title', async () => {
    const create = await request(app)
      .post('/v1/sessions')
      .set(auth)
      .send({ title: 'Original' });
    const id = create.body.id as string;

    const res = await request(app)
      .patch(`/v1/sessions/${id}`)
      .set(auth)
      .send({ title: 'Renamed' });
    expect(res.status).toBe(200);

    const get = await request(app).get(`/v1/sessions/${id}`).set(auth);
    expect(get.body.title).toBe('Renamed');
  });

  it('rejects title over 200 chars', async () => {
    const create = await request(app).post('/v1/sessions').set(auth).send({});
    const id = create.body.id as string;

    const res = await request(app)
      .patch(`/v1/sessions/${id}`)
      .set(auth)
      .send({ title: 'x'.repeat(201) });
    expect(res.status).toBe(400);
  });
});

// ── DELETE /v1/sessions/:id ──────────────────────────────────────────────────

describe('DELETE /v1/sessions/:id', () => {
  it('deletes a session and returns 204', async () => {
    const create = await request(app).post('/v1/sessions').set(auth).send({ title: 'Delete Me' });
    const id = create.body.id as string;

    const del = await request(app).delete(`/v1/sessions/${id}`).set(auth);
    expect(del.status).toBe(204);

    const get = await request(app).get(`/v1/sessions/${id}`).set(auth);
    expect(get.status).toBe(404);
  });

  it('returns 404 when deleting unknown session', async () => {
    const res = await request(app).delete('/v1/sessions/nope').set(auth);
    expect(res.status).toBe(404);
  });
});

// ── PATCH /v1/sessions/:id/model ─────────────────────────────────────────────

describe('PATCH /v1/sessions/:id/model', () => {
  it('sets the model override', async () => {
    const create = await request(app).post('/v1/sessions').set(auth).send({});
    const id = create.body.id as string;

    const res = await request(app)
      .patch(`/v1/sessions/${id}/model`)
      .set(auth)
      .send({ model: 'llama3.2' });
    expect(res.status).toBe(200);
    expect(res.body.model).toBe('llama3.2');
  });

  it('clears model override with null', async () => {
    const create = await request(app).post('/v1/sessions').set(auth).send({});
    const id = create.body.id as string;

    await request(app).patch(`/v1/sessions/${id}/model`).set(auth).send({ model: 'foo' });
    const res = await request(app)
      .patch(`/v1/sessions/${id}/model`)
      .set(auth)
      .send({ model: null });
    expect(res.status).toBe(200);
    expect(res.body.model).toBeNull();
  });
});

// ── DELETE /v1/sessions/:id/messages ─────────────────────────────────────────

describe('DELETE /v1/sessions/:id/messages', () => {
  it('clears all messages', async () => {
    const create = await request(app).post('/v1/sessions').set(auth).send({});
    const id = create.body.id as string;

    const res = await request(app).delete(`/v1/sessions/${id}/messages`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── POST /v1/sessions/:id/compact ────────────────────────────────────────────

describe('POST /v1/sessions/:id/compact', () => {
  it('compacts messages to keepLast', async () => {
    const create = await request(app).post('/v1/sessions').set(auth).send({});
    const id = create.body.id as string;

    const res = await request(app)
      .post(`/v1/sessions/${id}/compact`)
      .set(auth)
      .send({ keepLast: 20 });
    expect(res.status).toBe(200);
    expect(typeof res.body.messageCount).toBe('number');
  });

  it('rejects keepLast=0', async () => {
    const create = await request(app).post('/v1/sessions').set(auth).send({});
    const id = create.body.id as string;
    const res = await request(app)
      .post(`/v1/sessions/${id}/compact`)
      .set(auth)
      .send({ keepLast: 0 });
    expect(res.status).toBe(400);
  });
});

// ── PUT /v1/sessions/:id/budget ──────────────────────────────────────────────

describe('PUT /v1/sessions/:id/budget', () => {
  it('sets token budget', async () => {
    const create = await request(app).post('/v1/sessions').set(auth).send({});
    const id = create.body.id as string;

    const res = await request(app)
      .put(`/v1/sessions/${id}/budget`)
      .set(auth)
      .send({ tokenBudget: 10000 });
    expect(res.status).toBe(200);
  });

  it('clears budget with null', async () => {
    const create = await request(app).post('/v1/sessions').set(auth).send({});
    const id = create.body.id as string;

    const res = await request(app)
      .put(`/v1/sessions/${id}/budget`)
      .set(auth)
      .send({ tokenBudget: null });
    expect(res.status).toBe(200);
  });
});

// ── POST /v1/sessions/:id/branch ─────────────────────────────────────────────

describe('POST /v1/sessions/:id/branch', () => {
  it('creates a child session branched from parent', async () => {
    const parent = await request(app).post('/v1/sessions').set(auth).send({ title: 'Parent' });
    const parentId = parent.body.id as string;

    const res = await request(app)
      .post(`/v1/sessions/${parentId}/branch`)
      .set(auth)
      .send({ branchPoint: 0 });
    expect(res.status).toBe(201);
    expect(res.body.parentId).toBe(parentId);
    expect(res.body.id).not.toBe(parentId);
  });

  it('returns 404 branching from unknown session', async () => {
    const res = await request(app)
      .post('/v1/sessions/nonexistent/branch')
      .set(auth)
      .send({ branchPoint: 0 });
    expect(res.status).toBe(404);
  });
});

// ── GET /v1/sessions/:id/export ──────────────────────────────────────────────

describe('GET /v1/sessions/:id/export', () => {
  it('returns markdown content', async () => {
    const create = await request(app).post('/v1/sessions').set(auth).send({ title: 'Export Test' });
    const id = create.body.id as string;

    const res = await request(app).get(`/v1/sessions/${id}/export`).set(auth);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/markdown/);
  });
});
