import { describe, it, expect } from 'vitest';
import { evaluateGuardrails } from '../src/guardrails/engine.js';
import type { GuardRule } from '@koda/shared';

// ── helpers ───────────────────────────────────────────────────────────────────

function rule(overrides: Partial<GuardRule> = {}): GuardRule {
  return {
    id: 'test-rule',
    enabled: true,
    description: 'test rule',
    tools: ['*'],
    action: 'block',
    message: 'blocked by test rule',
    ...overrides,
  };
}

// ── evaluateGuardrails ────────────────────────────────────────────────────────

describe('evaluateGuardrails — basic matching', () => {
  it('returns not-triggered for empty rules array', () => {
    expect(evaluateGuardrails([], 'bash', { command: 'ls' })).toEqual({ triggered: false });
  });

  it('returns not-triggered for a disabled rule', () => {
    const r = rule({ enabled: false });
    expect(evaluateGuardrails([r], 'bash', {})).toEqual({ triggered: false });
  });

  it('triggers on wildcard tool match (*)', () => {
    const r = rule({ tools: ['*'], action: 'warn' });
    expect(evaluateGuardrails([r], 'bash', {}).triggered).toBe(true);
    expect(evaluateGuardrails([r], 'read_file', {}).triggered).toBe(true);
  });

  it('triggers on specific tool match', () => {
    const r = rule({ tools: ['bash'] });
    expect(evaluateGuardrails([r], 'bash', {}).triggered).toBe(true);
  });

  it('does not trigger for a different tool', () => {
    const r = rule({ tools: ['bash'] });
    expect(evaluateGuardrails([r], 'read_file', {}).triggered).toBe(false);
  });

  it('returns the matched rule on trigger', () => {
    const r = rule({ id: 'my-rule', tools: ['bash'] });
    const result = evaluateGuardrails([r], 'bash', {});
    expect(result.rule?.id).toBe('my-rule');
  });
});

describe('evaluateGuardrails — commandPattern', () => {
  it('matches commandPattern (case-insensitive)', () => {
    const r = rule({ tools: ['bash'], commandPattern: 'rm\\s+-rf' });
    expect(evaluateGuardrails([r], 'bash', { command: 'rm -rf /' }).triggered).toBe(true);
    expect(evaluateGuardrails([r], 'bash', { command: 'RM -RF /tmp' }).triggered).toBe(true);
  });

  it('does not trigger when command does not match pattern', () => {
    const r = rule({ tools: ['bash'], commandPattern: 'dangerous' });
    expect(evaluateGuardrails([r], 'bash', { command: 'npm test' }).triggered).toBe(false);
  });

  it('does not trigger when tool has no command arg', () => {
    const r = rule({ tools: ['bash'], commandPattern: 'rm' });
    // No `command` key in args — commandPattern check should return false
    expect(evaluateGuardrails([r], 'bash', {}).triggered).toBe(false);
  });

  it('handles invalid regex in commandPattern gracefully (returns false)', () => {
    const r = rule({ tools: ['bash'], commandPattern: '[invalid' });
    expect(() => evaluateGuardrails([r], 'bash', { command: 'ls' })).not.toThrow();
    expect(evaluateGuardrails([r], 'bash', { command: 'ls' }).triggered).toBe(false);
  });
});

describe('evaluateGuardrails — pathPattern', () => {
  it('matches pathPattern with glob', () => {
    const r = rule({ tools: ['write_file'], pathPattern: '*.env' });
    expect(evaluateGuardrails([r], 'write_file', { path: '.env' }).triggered).toBe(true);
    expect(evaluateGuardrails([r], 'write_file', { path: 'production.env' }).triggered).toBe(true);
  });

  it('does not trigger when path does not match glob', () => {
    const r = rule({ tools: ['write_file'], pathPattern: '*.env' });
    expect(evaluateGuardrails([r], 'write_file', { path: 'src/app.ts' }).triggered).toBe(false);
  });

  it('does not trigger when tool has no path arg', () => {
    const r = rule({ tools: ['bash'], pathPattern: '*.ts' });
    // bash has no path arg — pathPattern should not match
    expect(evaluateGuardrails([r], 'bash', { command: 'npm test' }).triggered).toBe(false);
  });
});

describe('evaluateGuardrails — action priority', () => {
  it('block action returns triggered=true with block rule', () => {
    const r = rule({ action: 'block' });
    const result = evaluateGuardrails([r], 'bash', {});
    expect(result.triggered).toBe(true);
    expect(result.rule?.action).toBe('block');
  });

  it('warn action returns triggered=true with warn rule', () => {
    const r = rule({ action: 'warn' });
    const result = evaluateGuardrails([r], 'bash', {});
    expect(result.triggered).toBe(true);
    expect(result.rule?.action).toBe('warn');
  });

  it('block takes priority over warn when both rules match', () => {
    const warn = rule({ id: 'warn-rule', action: 'warn', tools: ['bash'] });
    const block = rule({ id: 'block-rule', action: 'block', tools: ['bash'] });
    const result = evaluateGuardrails([warn, block], 'bash', {});
    expect(result.rule?.action).toBe('block');
    expect(result.rule?.id).toBe('block-rule');
  });

  it('block priority holds regardless of rule order', () => {
    const block = rule({ id: 'block-rule', action: 'block', tools: ['bash'] });
    const warn = rule({ id: 'warn-rule', action: 'warn', tools: ['bash'] });
    // block listed first
    expect(evaluateGuardrails([block, warn], 'bash', {}).rule?.action).toBe('block');
    // warn listed first — block should still win
    expect(evaluateGuardrails([warn, block], 'bash', {}).rule?.action).toBe('block');
  });
});

describe('evaluateGuardrails — multiple rules', () => {
  it('returns the first matching rule when all are warn', () => {
    const r1 = rule({ id: 'first', action: 'warn', tools: ['bash'] });
    const r2 = rule({ id: 'second', action: 'warn', tools: ['bash'] });
    const result = evaluateGuardrails([r1, r2], 'bash', {});
    expect(result.rule?.id).toBe('first');
  });

  it('correctly ignores non-matching rules in a mixed list', () => {
    const irrelevant = rule({ tools: ['write_file'] });
    const matching = rule({ id: 'matching', tools: ['bash'], action: 'warn' });
    const result = evaluateGuardrails([irrelevant, matching], 'bash', {});
    expect(result.rule?.id).toBe('matching');
  });
});
