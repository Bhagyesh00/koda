import { describe, it, expect } from 'vitest';
import { trimMessages } from '../src/agent/loop.js';
import type { OllamaMessage } from '../src/agent/ollama.js';

// Regression tests for the orphan-tool bug. Before the fix, trimMessages could
// return a window starting with a `tool` message whose parent assistant call
// had been trimmed away — Ollama then rejected the request with
// "tool message without preceding tool_calls".

describe('trimMessages', () => {
  it('preserves system message at the head', () => {
    const messages: OllamaMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ];
    const result = trimMessages(messages);
    expect(result[0]?.role).toBe('system');
  });

  it('returns input unchanged when empty', () => {
    expect(trimMessages([])).toEqual([]);
  });

  it('drops a leading tool message whose assistant parent was trimmed', () => {
    // Build a synthetic transcript large enough to force trimming. The first
    // assistant/tool pair must be dropped; the trim window must NOT begin
    // with the orphan `tool` reply.
    const big = 'x'.repeat(20_000);
    const messages: OllamaMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'assistant', content: big, tool_calls: [{ function: { name: 'bash', arguments: {} } }] },
      { role: 'tool', content: 'first tool reply' },
      { role: 'assistant', content: big },
      { role: 'user', content: 'follow up' },
      { role: 'assistant', content: 'final answer' },
    ];

    const result = trimMessages(messages);
    const afterSystem = result.slice(1);
    // No matter where the trim window starts, the first non-system message
    // must NOT be an orphan `tool` reply.
    expect(afterSystem[0]?.role).not.toBe('tool');
  });

  it('keeps the most recent messages', () => {
    const messages: OllamaMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
    ];
    const result = trimMessages(messages);
    // Last message should still be present (it's the most recent).
    expect(result.at(-1)?.content).toBe('a2');
  });
});
