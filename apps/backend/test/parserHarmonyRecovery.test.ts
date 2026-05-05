import { describe, it, expect } from 'vitest';
import {
  parseAllToolCalls,
  stripSpecialTokens,
  stripToolCallFences,
} from '../src/agent/parser.js';

// Some OSS base models (gpt-oss / Qwen channel-format) leak special tokens
// like <|tool_call|>, <|channel|>, <|message|>, <|return|> into the content
// stream when their chat template doesn't strip them. The user-reported
// symptom was a chat full of `call:bash{command:<|"|>npm run lint<|"|>}<tool_call|>`
// fragments. The parser must (a) recognise these as tool calls when possible
// and (b) scrub the orphans from visible prose.

describe('parser — Harmony / channel-format recovery', () => {
  it('parses a Harmony-style <|tool_call|>{...}<|/tool_call|> block', () => {
    const text =
      'Let me list files first.\n' +
      '<|tool_call|>{"name":"list_dir","args":{"path":"."}}<|/tool_call|>';
    const calls = parseAllToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('list_dir');
    expect(calls[0]?.args).toEqual({ path: '.' });
  });

  it('parses a Harmony-style block closed with <|message|>', () => {
    const text =
      '<|tool_call|>{"name":"read_file","args":{"path":"src/index.ts"}}<|message|>';
    const calls = parseAllToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('read_file');
  });

  it('parses a loose `call:name{...}` recovery when no fence/Harmony exists', () => {
    // The exact pattern from the user-reported failure. Note the unquoted
    // identifier key — the loose parser auto-repairs that.
    const text = 'call:bash{command:"npm run lint"}<|tool_call|>';
    const calls = parseAllToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('bash');
    expect(calls[0]?.args).toEqual({ command: 'npm run lint' });
  });

  it('repairs unquoted JSON keys in loose calls', () => {
    const text = 'call:read_file{path:"a.ts"}\n\n';
    const calls = parseAllToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual({ path: 'a.ts' });
  });

  it('canonical fence wins when both fence and loose patterns are present', () => {
    const text =
      '```tool_call\n{"name":"good","args":{"path":"a.ts"}}\n```\n' +
      'call:bad{path:"b.ts"}<|tool_call|>';
    const calls = parseAllToolCalls(text);
    // Loose pattern is suppressed when canonical fence already produced calls,
    // so we don't double-count or pick up a phantom second call.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('good');
  });

  it('returns multiple calls when multiple Harmony blocks appear', () => {
    const text =
      '<|tool_call|>{"name":"a","args":{}}<|/tool_call|>\n' +
      '<|tool_call|>{"name":"b","args":{}}<|/tool_call|>';
    const calls = parseAllToolCalls(text);
    expect(calls.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('returns empty when the loose call is unparseable garbage', () => {
    expect(parseAllToolCalls('call:bash{not even close to JSON')).toEqual([]);
  });
});

describe('stripSpecialTokens', () => {
  it('removes Harmony channel/tool_call/message tokens', () => {
    const noisy =
      'before <|channel|>commentary<|message|>middle <|tool_call|>after';
    expect(stripSpecialTokens(noisy)).toBe('before commentarymiddle after');
  });

  it('leaves normal pipe characters alone', () => {
    expect(stripSpecialTokens('a | b | c')).toBe('a | b | c');
  });

  it('handles strings with no special tokens', () => {
    expect(stripSpecialTokens('plain prose')).toBe('plain prose');
  });
});

describe('stripToolCallFences', () => {
  it('strips both canonical fences and Harmony blocks together', () => {
    const text =
      'thinking out loud\n' +
      '```tool_call\n{"name":"a"}\n```\n' +
      '<|tool_call|>{"name":"b"}<|/tool_call|>\n' +
      'final summary';
    const out = stripToolCallFences(text);
    expect(out).not.toContain('tool_call');
    expect(out).not.toContain('<|');
    expect(out).toContain('thinking out loud');
    expect(out).toContain('final summary');
  });

  it('strips orphan special tokens that did not match a structured pattern', () => {
    const text = 'hello <|return|> world <|end|>';
    expect(stripToolCallFences(text)).toBe('hello  world');
  });

  it('strips loose call:name{...} fragments from prose', () => {
    const text = 'I will run call:bash{command:"ls"} now.';
    const out = stripToolCallFences(text);
    expect(out).not.toContain('call:bash');
  });
});
