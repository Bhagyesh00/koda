import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from '../src/server.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const TOKEN = process.env.AUTH_TOKEN ?? 'dev-secret-change-me';
const app = createServer();
const auth = { Authorization: `Bearer ${TOKEN}` };

// Create temp files for upload tests
function tmpFile(name: string, content: string): string {
  const p = path.join(os.tmpdir(), name);
  fs.writeFileSync(p, content);
  return p;
}

describe('POST /v1/upload', () => {
  it('uploads a text file successfully', async () => {
    const file = tmpFile('test.txt', 'Hello from upload test');
    const res = await request(app)
      .post('/v1/upload')
      .set(auth)
      .attach('files', file);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.files)).toBe(true);
    expect(res.body.files).toHaveLength(1);
    expect(res.body.files[0].originalName).toBe('test.txt');
    expect(typeof res.body.files[0].path).toBe('string');
    expect(res.body.files[0].size).toBeGreaterThan(0);
  });

  it('uploads multiple files', async () => {
    const f1 = tmpFile('a.txt', 'File A');
    const f2 = tmpFile('b.md', '# File B');
    const res = await request(app)
      .post('/v1/upload')
      .set(auth)
      .attach('files', f1)
      .attach('files', f2);
    expect(res.status).toBe(200);
    expect(res.body.files).toHaveLength(2);
  });

  it('uploads a JSON file', async () => {
    const file = tmpFile('data.json', JSON.stringify({ key: 'value' }));
    const res = await request(app)
      .post('/v1/upload')
      .set(auth)
      .attach('files', file);
    expect(res.status).toBe(200);
    expect(res.body.files[0].mimeType).toBeTruthy();
  });

  it('rejects disallowed file types', async () => {
    const file = tmpFile('payload.exe', 'MZ fake binary');
    const res = await request(app)
      .post('/v1/upload')
      .set(auth)
      .attach('files', file);
    expect(res.status).toBe(400);
  });

  it('returns 400 when no files are sent', async () => {
    // .field() sends a proper multipart/form-data request (with boundary) but no file parts
    const res = await request(app)
      .post('/v1/upload')
      .set(auth)
      .field('_empty', '1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 401 without auth token', async () => {
    // No file attached — avoids ECONNRESET from server closing mid-upload
    const res = await request(app).post('/v1/upload').field('_empty', '1');
    expect(res.status).toBe(401);
  });

  it('serves uploaded file via GET /v1/uploads/:filename', async () => {
    const file = tmpFile('serve-me.txt', 'Serve this content');
    const upload = await request(app)
      .post('/v1/upload')
      .set(auth)
      .attach('files', file);
    const savedName = upload.body.files[0].savedName as string;

    const serve = await request(app)
      .get(`/v1/uploads/${savedName}`)
      .set(auth);
    expect(serve.status).toBe(200);
    expect(serve.text).toContain('Serve this content');
  });

  it('returns 404 for unknown upload file', async () => {
    const res = await request(app)
      .get('/v1/uploads/nonexistent-file.txt')
      .set(auth);
    expect(res.status).toBe(404);
  });
});
