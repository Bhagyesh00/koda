import { describe, it, expect } from 'vitest';

// Phase 6 Fix 3 — when the model burns through its thinking budget without
// producing a tool call, ollama.ts must close the <think> tag, stop forwarding
// further thinking deltas, and notify the caller exactly once.
//
// We test the streaming behaviour by faking a `fetch` that returns a synthetic
// NDJSON Ollama response, then asserting on the captured output.

import { streamOllamaChat } from '../src/agent/ollama.js';

function makeFakeStream(chunks: object[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n'));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

describe('streamOllamaChat thinking-budget cap', () => {
  it('closes <think> and notifies caller when thinking exceeds budget', async () => {
    const big = 'a'.repeat(2_000); // single chunk of 2 000 chars
    const chunks = [
      { message: { role: 'assistant', content: '', thinking: big } },
      { message: { role: 'assistant', content: '', thinking: big } },
      { message: { role: 'assistant', content: '', thinking: big } },
      { message: { role: 'assistant', content: '', thinking: big } },
      { message: { role: 'assistant', content: '', thinking: big } },
      { message: { role: 'assistant', content: '', thinking: big } },
      // After the budget trips, this thinking chunk should be dropped:
      { message: { role: 'assistant', content: '', thinking: 'should not appear' } },
      // Content after the trip should still be forwarded:
      { message: { role: 'assistant', content: 'final answer' }, done: true },
    ];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(makeFakeStream(chunks))) as typeof fetch;

    let exceededBytes = -1;
    let exceededCalls = 0;
    let captured = '';
    try {
      const result = await streamOllamaChat(
        [{ role: 'user', content: 'hi' }],
        (delta) => { captured += delta; },
        undefined,
        {
          thinkingBudgetBytes: 4_000,
          onThinkingBudgetExceeded: (b) => { exceededBytes = b; exceededCalls++; },
        },
      );
      expect(result.thinkingBudgetExceeded).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(exceededCalls).toBe(1);
    expect(exceededBytes).toBeGreaterThanOrEqual(4_000);
    expect(captured).toContain('<think>');
    expect(captured).toContain('</think>');     // tag must close
    expect(captured).not.toContain('should not appear');
    expect(captured).toContain('final answer');  // content still flows
  });

  it('does not fire when thinking stays under budget', async () => {
    const chunks = [
      { message: { role: 'assistant', content: '', thinking: 'short reasoning' } },
      { message: { role: 'assistant', content: 'done' }, done: true },
    ];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(makeFakeStream(chunks))) as typeof fetch;

    let exceededCalls = 0;
    try {
      const result = await streamOllamaChat(
        [{ role: 'user', content: 'hi' }],
        () => {},
        undefined,
        {
          thinkingBudgetBytes: 10_000,
          onThinkingBudgetExceeded: () => { exceededCalls++; },
        },
      );
      expect(result.thinkingBudgetExceeded).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(exceededCalls).toBe(0);
  });

  it('disables the cap entirely when budget is 0', async () => {
    const big = 'x'.repeat(50_000);
    const chunks = [
      { message: { role: 'assistant', content: '', thinking: big } },
      { message: { role: 'assistant', content: 'ok' }, done: true },
    ];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(makeFakeStream(chunks))) as typeof fetch;

    let exceededCalls = 0;
    try {
      await streamOllamaChat(
        [{ role: 'user', content: 'hi' }],
        () => {},
        undefined,
        {
          thinkingBudgetBytes: 0,
          onThinkingBudgetExceeded: () => { exceededCalls++; },
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(exceededCalls).toBe(0);
  });
});
