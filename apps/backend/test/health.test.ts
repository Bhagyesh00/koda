import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from '../src/server.js';

const app = createServer();

describe('GET /v1/health', () => {
  it('returns ok without auth token', async () => {
    const res = await request(app).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.workDir).toBe('string');
    expect(typeof res.body.model).toBe('string');
  });

  it('response includes ollama status field', async () => {
    const res = await request(app).get('/v1/health');
    // ollama field exists (may be ok:false if server is not running in test)
    expect(res.body).toHaveProperty('ollama');
    expect(typeof res.body.ollama.ok).toBe('boolean');
  });
});
