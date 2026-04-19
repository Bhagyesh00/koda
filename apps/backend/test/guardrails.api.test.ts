import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from '../src/server.js';

const TOKEN = process.env.AUTH_TOKEN ?? 'dev-secret-change-me';
const app = createServer();
const auth = { Authorization: `Bearer ${TOKEN}` };

async function createSession(): Promise<string> {
  const res = await request(app).post('/v1/sessions').set(auth).send({ title: 'Guardrails Test' });
  return res.body.id as string;
}

describe('GET /v1/sessions/:id/guardrails', () => {
  it('returns empty array for new session', async () => {
    const id = await createSession();
    const res = await request(app).get(`/v1/sessions/${id}/guardrails`).set(auth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.guardrails)).toBe(true);
    expect(res.body.guardrails).toHaveLength(0);
  });
});

describe('POST /v1/sessions/:id/guardrails', () => {
  it('creates a blocking guardrail rule', async () => {
    const id = await createSession();
    const res = await request(app)
      .post(`/v1/sessions/${id}/guardrails`)
      .set(auth)
      .send({
        description: 'Block rm -rf',
        tools: ['bash'],
        action: 'block',
        message: 'Dangerous command blocked',
        commandPattern: 'rm\\s+-rf',
        enabled: true,
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.action).toBe('block');
  });

  it('creates a warning guardrail rule', async () => {
    const id = await createSession();
    const res = await request(app)
      .post(`/v1/sessions/${id}/guardrails`)
      .set(auth)
      .send({
        description: 'Warn on git push',
        tools: ['bash'],
        action: 'warn',
        message: 'Are you sure you want to push?',
        commandPattern: 'git push',
        enabled: true,
      });
    expect(res.status).toBe(201);
    expect(res.body.action).toBe('warn');
  });

  it('creates a wildcard rule covering all tools', async () => {
    const id = await createSession();
    const res = await request(app)
      .post(`/v1/sessions/${id}/guardrails`)
      .set(auth)
      .send({
        description: 'Block everything',
        tools: ['*'],
        action: 'block',
        message: 'All tools blocked',
        enabled: true,
      });
    expect(res.status).toBe(201);
  });
});

describe('PATCH /v1/sessions/:id/guardrails/:ruleId', () => {
  it('updates a guardrail rule', async () => {
    const id = await createSession();
    const create = await request(app)
      .post(`/v1/sessions/${id}/guardrails`)
      .set(auth)
      .send({ description: 'Test rule', tools: ['bash'], action: 'warn', message: 'Warn', enabled: true });
    const ruleId = create.body.id as string;

    const patch = await request(app)
      .patch(`/v1/sessions/${id}/guardrails/${ruleId}`)
      .set(auth)
      .send({ enabled: false });
    expect(patch.status).toBe(200);
  });
});

describe('DELETE /v1/sessions/:id/guardrails/:ruleId', () => {
  it('deletes a guardrail rule', async () => {
    const id = await createSession();
    const create = await request(app)
      .post(`/v1/sessions/${id}/guardrails`)
      .set(auth)
      .send({ description: 'Delete Me', tools: ['bash'], action: 'block', message: 'blocked', enabled: true });
    const ruleId = create.body.id as string;

    const del = await request(app)
      .delete(`/v1/sessions/${id}/guardrails/${ruleId}`)
      .set(auth);
    expect(del.status).toBe(204);
  });
});
