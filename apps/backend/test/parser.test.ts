import { describe, it, expect } from 'vitest';
import {
  parseAllToolCalls,
  parseToolCall,
  stripToolCallFences,
  stripToolCallFence,
  extractThinkingBlocks,
  stripThinkingBlocks,
} from '../src/agent/parser.js';

// ── parseAllToolCalls ─────────────────────────────────────────────────────────

describe('parseAllToolCalls', () => {
  it('returns empty array for plain text', () => {
    expect(parseAllToolCalls('hello world')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseAllToolCalls('')).toEqual([]);
  });

  it('parses a single fence block', () => {
    const text = 'Sure, let me check.\n\n```tool_call\n{"name":"list_dir","args":{"path":"."}}\n```';
    const calls = parseAllToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('list_dir');
    expect(calls[0]?.args).toEqual({ path: '.' });
  });

  it('parses multiple fence blocks in order', () => {
    const text = [
      '```tool_call\n{"name":"read_file","args":{"path":"a.ts"}}\n```',
      '```tool_call\n{"name":"write_file","args":{"path":"b.ts","content":"x"}}\n```',
    ].join('\n\n');
    const calls = parseAllToolCalls(text);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.name).toBe('read_file');
    expect(calls[1]?.name).toBe('write_file');
  });

  it('skips malformed JSON and returns other valid calls', () => {
    const text = [
      '```tool_call\n{not valid json}\n```',
      '```tool_call\n{"name":"bash","args":{"command":"ls"}}\n```',
    ].join('\n\n');
    const calls = parseAllToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('bash');
  });

  it('returns null on malformed JSON (parseToolCall compat)', () => {
    expect(parseToolCall('```tool_call\nnot json\n```')).toBeNull();
  });

  it('skips blocks missing the name field', () => {
    const text = '```tool_call\n{"args":{"path":"foo.ts"}}\n```';
    expect(parseAllToolCalls(text)).toEqual([]);
  });

  it('skips blocks where name is not a string', () => {
    const text = '```tool_call\n{"name":42,"args":{}}\n```';
    expect(parseAllToolCalls(text)).toEqual([]);
  });

  it('defaults args to {} when args key is absent', () => {
    const text = '```tool_call\n{"name":"bash"}\n```';
    const calls = parseAllToolCalls(text);
    expect(calls[0]?.args).toEqual({});
  });

  it('handles whitespace inside fence block', () => {
    const text = '```tool_call\n  {"name":"bash","args":{"command":"ls"}}  \n```';
    const calls = parseAllToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('bash');
  });

  it('handles nested objects in args', () => {
    const text = '```tool_call\n{"name":"decide","args":{"question":"?","options":[{"label":"A","pros":[],"cons":[]}]}}\n```';
    const calls = parseAllToolCalls(text);
    expect(calls[0]?.name).toBe('decide');
    expect((calls[0]?.args as { question: string }).question).toBe('?');
  });

  it('is safe to call multiple times — no stale regex state', () => {
    const text = '```tool_call\n{"name":"read_file","args":{"path":"a.ts"}}\n```';
    expect(parseAllToolCalls(text)).toHaveLength(1);
    expect(parseAllToolCalls(text)).toHaveLength(1);
    expect(parseAllToolCalls(text)).toHaveLength(1);
  });

  it('records fenceStart at the opening backticks', () => {
    const prefix = 'prefix\n';
    const fence = '```tool_call\n{"name":"bash","args":{"command":"ls"}}\n```';
    const calls = parseAllToolCalls(prefix + fence);
    expect(calls[0]?.fenceStart).toBe(prefix.length);
  });

  it('fenceEnd covers the closing backticks', () => {
    const fence = '```tool_call\n{"name":"bash","args":{"command":"ls"}}\n```';
    const calls = parseAllToolCalls(fence);
    expect(calls[0]?.fenceEnd).toBe(fence.length);
  });

  it('does not match unclosed fences', () => {
    const text = '```tool_call\n{"name":"bash","args":{"command":"ls"}}';
    expect(parseAllToolCalls(text)).toEqual([]);
  });
});

// ── parseToolCall ─────────────────────────────────────────────────────────────

describe('parseToolCall (single)', () => {
  it('returns null for empty string', () => {
    expect(parseToolCall('')).toBeNull();
  });

  it('returns null when no fence block exists', () => {
    expect(parseToolCall('just talking')).toBeNull();
  });

  it('parses the first fence block', () => {
    const text = 'Sure, let me check.\n\n```tool_call\n{"name":"list_dir","args":{"path":"."}}\n```';
    const parsed = parseToolCall(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.name).toBe('list_dir');
    expect(parsed?.args).toEqual({ path: '.' });
  });

  it('returns the first call when multiple exist', () => {
    const text = [
      '```tool_call\n{"name":"read_file","args":{"path":"a.ts"}}\n```',
      '```tool_call\n{"name":"bash","args":{"command":"ls"}}\n```',
    ].join('\n');
    expect(parseToolCall(text)?.name).toBe('read_file');
  });
});

// ── stripToolCallFences / stripToolCallFence ──────────────────────────────────

describe('stripToolCallFences', () => {
  it('leaves plain text unchanged', () => {
    expect(stripToolCallFences('hello')).toBe('hello');
  });

  it('strips a single fence and trims', () => {
    const text = 'Hello\n\n```tool_call\n{"name":"x","args":{}}\n```\n';
    expect(stripToolCallFences(text)).toBe('Hello');
  });

  it('strips multiple fences', () => {
    const text = 'a\n```tool_call\n{"name":"x","args":{}}\n```\nb\n```tool_call\n{"name":"y","args":{}}\n```\nc';
    expect(stripToolCallFences(text)).not.toContain('tool_call');
  });

  it('stripToolCallFence alias works identically', () => {
    const text = 'Hello\n\n```tool_call\n{"name":"x","args":{}}\n```\n';
    expect(stripToolCallFence(text)).toBe(stripToolCallFences(text));
  });
});

// ── extractThinkingBlocks ─────────────────────────────────────────────────────

describe('extractThinkingBlocks', () => {
  it('returns empty array when no blocks present', () => {
    expect(extractThinkingBlocks('plain text')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(extractThinkingBlocks('')).toEqual([]);
  });

  it('extracts a single block', () => {
    expect(extractThinkingBlocks('<think>inner</think>')).toEqual(['inner']);
  });

  it('extracts multiple blocks in order', () => {
    expect(extractThinkingBlocks('<think>first</think> x <think>second</think>')).toEqual([
      'first',
      'second',
    ]);
  });

  it('trims whitespace from block content', () => {
    expect(extractThinkingBlocks('<think>  spaces  </think>')).toEqual(['spaces']);
  });

  it('handles multi-line content', () => {
    const text = '<think>line one\nline two</think>';
    expect(extractThinkingBlocks(text)).toEqual(['line one\nline two']);
  });

  it('does not extract from an unclosed tag', () => {
    expect(extractThinkingBlocks('<think>unclosed')).toEqual([]);
  });
});

// ── stripThinkingBlocks ───────────────────────────────────────────────────────

describe('stripThinkingBlocks', () => {
  it('leaves plain text unchanged', () => {
    expect(stripThinkingBlocks('hello world')).toBe('hello world');
  });

  it('removes a single think block', () => {
    expect(stripThinkingBlocks('<think>hidden</think>visible')).toBe('visible');
  });

  it('removes multiple think blocks', () => {
    expect(stripThinkingBlocks('<think>a</think>mid<think>b</think>end')).toBe('midend');
  });

  it('trims surrounding whitespace after removal', () => {
    expect(stripThinkingBlocks('<think>thought</think>  answer  ')).toBe('answer');
  });

  it('returns empty string when everything is in think blocks', () => {
    expect(stripThinkingBlocks('<think>all hidden</think>')).toBe('');
  });
});
