import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createServer } from '../src/server.js';
import { techDebtStore } from '../src/techDebt/store.js';
import type { Finding } from '@koda/shared';

const TOKEN = process.env.AUTH_TOKEN ?? 'dev-secret-change-me';
const app = createServer();
const auth = { Authorization: `Bearer ${TOKEN}` };

// Phase 5 — /v1/tech-debt route smoke tests. The /scan endpoint is excluded
// here because it shells out to git/npm; it's covered by manual smoke tests.

function fakeFinding(opts: Partial<Finding> & { id: string }): Finding {
  return {
    id: opts.id,
    scanId: opts.scanId ?? 'scan-fake',
    workDir: opts.workDir ?? '/tmp/fake',
    ts: opts.ts ?? Date.now(),
    category: opts.category ?? 'todo_marker',
    severity: opts.severity ?? 'low',
    description: opts.description ?? 'fake finding',
    suggestion: opts.suggestion,
    status: opts.status ?? 'open',
    filePath: opts.filePath,
    line: opts.line,
    meta: opts.meta,
  };
}

describe('GET /v1/tech-debt', () => {
  beforeEach(async () => {
    techDebtStore._resetForTests();
    await techDebtStore.insertBatch([
      fakeFinding({ id: 'a', severity: 'low' }),
      fakeFinding({ id: 'b', severity: 'high', status: 'dismissed' }),
      fakeFinding({ id: 'c', severity: 'critical' }),
    ]);
  });

  afterAll(() => {
    techDebtStore._resetForTests();
  });

  it('lists all findings by default', async () => {
    const res = await request(app).get('/v1/tech-debt').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
  });

  it('?status=open filters to open findings', async () => {
    const res = await request(app).get('/v1/tech-debt?status=open').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect((res.body.findings as Finding[]).every((f) => f.status === 'open')).toBe(true);
  });

  it('?limit=1 caps results', async () => {
    const res = await request(app).get('/v1/tech-debt?limit=1').set(auth);
    expect(res.body.total).toBe(1);
  });
});

describe('GET /v1/tech-debt/summary', () => {
  beforeEach(async () => {
    techDebtStore._resetForTests();
    await techDebtStore.insertBatch([
      fakeFinding({ id: 'x', severity: 'low', category: 'todo_marker' }),
      fakeFinding({ id: 'y', severity: 'high', category: 'large_file' }),
      fakeFinding({ id: 'z', severity: 'high', category: 'large_file' }),
    ]);
  });

  it('returns aggregate counts by severity and category', async () => {
    const res = await request(app).get('/v1/tech-debt/summary').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.totalFindings).toBe(3);
    expect(res.body.bySeverity.low).toBe(1);
    expect(res.body.bySeverity.high).toBe(2);
    expect(res.body.byCategory.large_file).toBe(2);
    expect(res.body.byCategory.todo_marker).toBe(1);
  });
});

describe('PATCH /v1/tech-debt/:id', () => {
  beforeEach(async () => {
    techDebtStore._resetForTests();
    await techDebtStore.insertBatch([fakeFinding({ id: 'patchme', status: 'open' })]);
  });

  it('marks a finding as dismissed', async () => {
    const res = await request(app)
      .patch('/v1/tech-debt/patchme')
      .set(auth)
      .send({ status: 'dismissed' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('dismissed');
  });

  it('marks a finding as fixed', async () => {
    const res = await request(app)
      .patch('/v1/tech-debt/patchme')
      .set(auth)
      .send({ status: 'fixed' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('fixed');
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .patch('/v1/tech-debt/does-not-exist')
      .set(auth)
      .send({ status: 'fixed' });
    expect(res.status).toBe(404);
  });
});
