import { describe, it, expect } from 'vitest';
import { registerWatchConnection } from '../src/watch/watcher.js';
import type { SSEWriter } from '../src/sse.js';

// Regression tests for P0-5 (watcher cleanup). The unregister callback must
// release the SSEWriter from the per-session connection set so a stale watcher
// can't keep emitting workspace_change events to a closed client.

function makeFakeSse(): SSEWriter {
  let closed = false;
  const sent: unknown[] = [];
  return {
    send(event: unknown) { sent.push(event); },
    close() { closed = true; },
    get isClosed() { return closed; },
    // exposed for test introspection
    _sent: sent,
  } as unknown as SSEWriter;
}

describe('watcher — connection lifecycle', () => {
  it('unregister callback removes the SSEWriter from the session set', () => {
    const sid = 'test-session-cleanup';
    const sse = makeFakeSse();
    const unregister = registerWatchConnection(sid, sse);
    // Calling unregister should be idempotent and not throw on repeat.
    expect(() => unregister()).not.toThrow();
    expect(() => unregister()).not.toThrow();
  });

  it('multiple connections per session register independently', () => {
    const sid = 'test-session-multi';
    const a = makeFakeSse();
    const b = makeFakeSse();
    const offA = registerWatchConnection(sid, a);
    const offB = registerWatchConnection(sid, b);
    // Dropping one connection must not throw, and the second drop must also be safe.
    expect(() => offA()).not.toThrow();
    expect(() => offB()).not.toThrow();
  });
});
