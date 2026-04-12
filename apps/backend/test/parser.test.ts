import { describe, it, expect } from 'vitest';
import { parseToolCall, stripToolCallFence } from '../src/agent/parser.js';

describe('parseToolCall', () => {
  it('parses a fenced tool_call block', () => {
    const text = 'Sure, let me check.\n\n```tool_call\n{"name":"list_dir","args":{"path":"."}}\n```';
    const parsed = parseToolCall(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.name).toBe('list_dir');
    expect(parsed?.args).toEqual({ path: '.' });
  });

  it('returns null when no fence', () => {
    expect(parseToolCall('just talking')).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    expect(parseToolCall('```tool_call\nnot json\n```')).toBeNull();
  });

  it('strips the fence from prose', () => {
    const text = 'Hello\n\n```tool_call\n{"name":"x","args":{}}\n```\n';
    expect(stripToolCallFence(text)).toBe('Hello');
  });
});
