import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createServer } from '../src/server.js';
import { sessionStore } from '../src/sessions/store.js';

const TOKEN = process.env.AUTH_TOKEN ?? 'dev-secret-change-me';
const app = createServer();
const auth = { Authorization: `Bearer ${TOKEN}` };

// Phase 1 — Decision Ledger: validates the unified projection across the four
// decision-shaped session arrays (proofs, hypotheses, checkpoints, rejections).

describe('GET /v1/ledger/:sessionId', () => {
  let sessionId: string;

  beforeAll(async () => {
    const s = sessionStore.create({ title: 'Ledger Test' });
    sessionId = s.id;
    sessionStore.addProof(sessionId, {
      messageId: 'm1',
      hash: 'h',
      signature: 'sig',
      ts: 1_000,
      reason: 'turn-end proof',
    });
    sessionStore.addHypothesis(sessionId, {
      id: 'hyp1',
      claim: 'tests pass',
      verification: 'pnpm test',
      expectedOutcome: 'exit 0',
      result: 'confirmed',
      ts: 2_000,
      reason: 'pre-write check',
    });
    sessionStore.addCheckpoint(sessionId, {
      id: 'cp1',
      ts: 3_000,
      messageIndex: 5,
      summary: 'before refactor',
      toolCallsSoFar: 12,
      reason: 'risky migration',
    });
    sessionStore.addRejection(sessionId, {
      ts: 4_000,
      context: 'bash call',
      rejected: 'rm -rf /',
      reason: 'destructive',
    });
    await sessionStore.flush(sessionId);
  });

  afterAll(async () => {
    sessionStore.delete(sessionId);
    await sessionStore.flush();
  });

  it('returns all four decision kinds, newest first', async () => {
    const res = await request(app).get(`/v1/ledger/${sessionId}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    const kinds = (res.body.decisions as Array<{ kind: string }>).map((d) => d.kind);
    expect(new Set(kinds)).toEqual(new Set(['proof', 'hypothesis', 'checkpoint', 'rejection']));
    // Sorted descending by ts → first entry is the rejection at ts 4000.
    expect(res.body.decisions[0].kind).toBe('rejection');
    expect(res.body.decisions[0].reason).toBe('destructive');
  });

  it('?kind=proof filters to proofs only', async () => {
    const res = await request(app).get(`/v1/ledger/${sessionId}?kind=proof`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.decisions[0].kind).toBe('proof');
  });

  it('?since=<ts> drops earlier entries', async () => {
    const res = await request(app)
      .get(`/v1/ledger/${sessionId}?since=2500`)
      .set(auth);
    expect(res.status).toBe(200);
    // Only checkpoint (3000) and rejection (4000) survive.
    expect(res.body.total).toBe(2);
  });

  it('?q=<substring> matches summary and reason fields', async () => {
    const res = await request(app)
      .get(`/v1/ledger/${sessionId}?q=destructive`)
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.decisions[0].reason).toBe('destructive');
  });

  it('returns 404 for unknown session', async () => {
    const res = await request(app).get('/v1/ledger/does-not-exist').set(auth);
    expect(res.status).toBe(404);
  });
});

describe('GET /v1/ledger (cross-session)', () => {
  it('returns decisions from all sessions, sorted newest first', async () => {
    const res = await request(app).get('/v1/ledger?limit=10').set(auth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.decisions)).toBe(true);
    // Sort invariant: each ts must be <= the previous ts.
    const tss = (res.body.decisions as Array<{ ts: number }>).map((d) => d.ts);
    for (let i = 1; i < tss.length; i++) {
      expect(tss[i]).toBeLessThanOrEqual(tss[i - 1]!);
    }
  });
});
