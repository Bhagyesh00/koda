import { describe, it, expect, beforeEach } from 'vitest';
import { sessionStore } from '../src/sessions/store.js';

// Unit tests for session store — uses in-memory store (no DB needed)

describe('sessionStore — create', () => {
  it('creates a session with generated id and defaults', () => {
    const s = sessionStore.create({ title: 'Test Session' });
    expect(s.id).toBeTruthy();
    expect(s.title).toBe('Test Session');
    expect(s.messages).toEqual([]);
    expect(s.mode).toBe('build');
    expect(s.todos).toEqual([]);
    expect(s.guardrails).toEqual([]);
    expect(s.tokensUsed).toBe(0);
  });

  it('creates session with cwd', () => {
    const s = sessionStore.create({ cwd: '/tmp/test' });
    expect(s.cwd).toBe('/tmp/test');
  });

  it('creates session with parentId for branching', () => {
    const parent = sessionStore.create({ title: 'Parent' });
    const child = sessionStore.create({ title: 'Branch', parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
  });

  it('auto-generates title from id when not provided', () => {
    const s = sessionStore.create({});
    expect(s.title).toBeTruthy();
    expect(typeof s.title).toBe('string');
  });
});

describe('sessionStore — get', () => {
  it('returns session by id', () => {
    const s = sessionStore.create({ title: 'Find Me' });
    const found = sessionStore.get(s.id);
    expect(found?.id).toBe(s.id);
    expect(found?.title).toBe('Find Me');
  });

  it('returns undefined for unknown id', () => {
    expect(sessionStore.get('nonexistent-id')).toBeUndefined();
  });
});

describe('sessionStore — list', () => {
  it('includes newly created sessions', () => {
    const before = sessionStore.list().length;
    sessionStore.create({ title: 'List Test' });
    expect(sessionStore.list().length).toBeGreaterThan(before);
  });
});

describe('sessionStore — update', () => {
  it('persists title changes', () => {
    const s = sessionStore.create({ title: 'Original' });
    sessionStore.update({ ...s, title: 'Updated' });
    expect(sessionStore.get(s.id)?.title).toBe('Updated');
  });
});

describe('sessionStore — delete', () => {
  it('removes session and returns true', () => {
    const s = sessionStore.create({ title: 'Delete Me' });
    expect(sessionStore.delete(s.id)).toBe(true);
    expect(sessionStore.get(s.id)).toBeUndefined();
  });

  it('returns false for unknown id', () => {
    expect(sessionStore.delete('does-not-exist')).toBe(false);
  });
});

describe('sessionStore — appendMessage', () => {
  it('appends messages to the session', () => {
    const s = sessionStore.create({});
    sessionStore.appendMessage(s.id, {
      id: 'msg-1',
      role: 'user',
      content: 'Hello',
      createdAt: Date.now(),
    });
    const updated = sessionStore.get(s.id);
    expect(updated?.messages).toHaveLength(1);
    expect(updated?.messages[0]?.content).toBe('Hello');
  });

  it('is a no-op for unknown session id', () => {
    expect(() =>
      sessionStore.appendMessage('bad-id', {
        id: 'x',
        role: 'user',
        content: 'hello',
        createdAt: 0,
      }),
    ).not.toThrow();
  });
});

describe('sessionStore — clearMessages', () => {
  it('empties the messages array', () => {
    const s = sessionStore.create({});
    sessionStore.appendMessage(s.id, { id: '1', role: 'user', content: 'A', createdAt: 0 });
    sessionStore.appendMessage(s.id, { id: '2', role: 'assistant', content: 'B', createdAt: 0 });
    sessionStore.clearMessages(s.id);
    expect(sessionStore.get(s.id)?.messages).toHaveLength(0);
  });
});

describe('sessionStore — compactMessages', () => {
  it('keeps only the last N messages', () => {
    const s = sessionStore.create({});
    for (let i = 0; i < 10; i++) {
      sessionStore.appendMessage(s.id, { id: String(i), role: 'user', content: `msg ${i}`, createdAt: i });
    }
    sessionStore.compactMessages(s.id, 3);
    const msgs = sessionStore.get(s.id)?.messages ?? [];
    expect(msgs).toHaveLength(3);
    expect(msgs[2]?.content).toBe('msg 9');
  });

  it('does not error when keepLast > total messages', () => {
    const s = sessionStore.create({});
    sessionStore.appendMessage(s.id, { id: '1', role: 'user', content: 'only', createdAt: 0 });
    expect(() => sessionStore.compactMessages(s.id, 100)).not.toThrow();
    expect(sessionStore.get(s.id)?.messages).toHaveLength(1);
  });
});

describe('sessionStore — setMode', () => {
  it('switches between plan and build modes', () => {
    const s = sessionStore.create({});
    sessionStore.setMode(s.id, 'plan');
    expect(sessionStore.get(s.id)?.mode).toBe('plan');
    sessionStore.setMode(s.id, 'build');
    expect(sessionStore.get(s.id)?.mode).toBe('build');
  });
});

describe('sessionStore — addTokens', () => {
  it('accumulates token counts', () => {
    const s = sessionStore.create({});
    sessionStore.addTokens(s.id, 100);
    sessionStore.addTokens(s.id, 250);
    expect(sessionStore.get(s.id)?.tokensUsed).toBe(350);
  });
});

describe('sessionStore — addContextReads', () => {
  it('deduplicates file paths', () => {
    const s = sessionStore.create({});
    sessionStore.addContextReads(s.id, ['file.ts', 'other.ts']);
    sessionStore.addContextReads(s.id, ['file.ts', 'new.ts']);
    const reads = sessionStore.get(s.id)?.contextReads ?? [];
    const unique = new Set(reads);
    expect(unique.size).toBe(reads.length);
    expect(reads).toContain('file.ts');
    expect(reads).toContain('new.ts');
  });
});

describe('sessionStore — addSnapshot', () => {
  it('appends snapshot entries', () => {
    const s = sessionStore.create({});
    sessionStore.addSnapshot(s.id, { ref: 'snap-1', description: 'Before refactor', ts: Date.now() });
    const snaps = sessionStore.get(s.id)?.snapshots ?? [];
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.ref).toBe('snap-1');
  });
});

describe('sessionStore — setTokenBudget', () => {
  it('sets and clears token budget', () => {
    const s = sessionStore.create({});
    sessionStore.setTokenBudget(s.id, 5000);
    expect(sessionStore.get(s.id)?.tokenBudget).toBe(5000);
    sessionStore.setTokenBudget(s.id, null);
    expect(sessionStore.get(s.id)?.tokenBudget).toBeUndefined();
  });
});
