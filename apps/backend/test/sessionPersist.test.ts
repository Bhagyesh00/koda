import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { sessionStore } from '../src/sessions/store.js';
import { config } from '../src/config.js';

// Regression tests for the persist queue (P0-2/3). Before the fix, postgres
// writes were fire-and-forget and file writes had no coalescing — bursts of
// appendMessage could lose data and a delete racing with an in-flight persist
// could resurrect a session on disk.

const SESSIONS_DIR = path.join(config.WORK_DIR_ABS, '.koda', 'sessions');

function fileExists(id: string): boolean {
  return fs.existsSync(path.join(SESSIONS_DIR, `${id}.json`));
}

describe('sessionStore — persist coalescing', () => {
  let createdIds: string[] = [];
  beforeEach(() => { createdIds = []; });
  afterEach(async () => {
    // Drain any in-flight writes before deleting so the test doesn't leak files.
    await sessionStore.flush();
    for (const id of createdIds) sessionStore.delete(id);
    await sessionStore.flush();
  });

  it('flush() awaits queued writes so the file is durable', async () => {
    const s = sessionStore.create({ title: 'durable' });
    createdIds.push(s.id);
    sessionStore.appendMessage(s.id, { id: 'm1', role: 'user', content: 'hello', createdAt: 0 });
    await sessionStore.flush(s.id);
    expect(fileExists(s.id)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, `${s.id}.json`), 'utf8'));
    expect(onDisk.messages).toHaveLength(1);
    expect(onDisk.messages[0].content).toBe('hello');
  });

  it('coalesces a burst of writes into a final consistent on-disk state', async () => {
    const s = sessionStore.create({ title: 'burst' });
    createdIds.push(s.id);
    for (let i = 0; i < 50; i++) {
      sessionStore.appendMessage(s.id, { id: `m${i}`, role: 'user', content: `msg ${i}`, createdAt: i });
    }
    await sessionStore.flush(s.id);
    const onDisk = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, `${s.id}.json`), 'utf8'));
    expect(onDisk.messages).toHaveLength(50);
    expect(onDisk.messages[49].content).toBe('msg 49');
  });

  it('delete() does not let a queued persist resurrect the session', async () => {
    const s = sessionStore.create({ title: 'doomed' });
    // Enqueue a write, then delete before it can run.
    sessionStore.appendMessage(s.id, { id: 'm', role: 'user', content: 'x', createdAt: 0 });
    sessionStore.delete(s.id);
    await sessionStore.flush();
    expect(fileExists(s.id)).toBe(false);
    expect(sessionStore.get(s.id)).toBeUndefined();
  });
});
