import { describe, it, expect } from 'vitest';
import { evaluateRiskTier, evaluateGuardrails } from '../src/guardrails/engine.js';
import type { GuardRule } from '@koda/shared';

// Phase 2 — Action Governance regression tests for the risk-tier evaluator
// and backwards-compatibility of the existing pattern engine.

function tierRule(opts: {
  id?: string;
  tools?: string[];
  commandPattern?: string;
  pathPattern?: string;
  riskTier: 'low' | 'medium' | 'high' | 'critical';
}): GuardRule {
  return {
    id: opts.id ?? 'rt-1',
    enabled: true,
    description: 'risk tier',
    kind: 'risk_tier',
    tools: opts.tools ?? ['*'],
    pathPattern: opts.pathPattern,
    commandPattern: opts.commandPattern,
    action: 'tier',
    message: 'tier',
    riskTier: opts.riskTier,
  };
}

describe('evaluateRiskTier', () => {
  it('returns null when there are no tier rules', () => {
    expect(evaluateRiskTier([], 'bash', { command: 'ls' })).toBeNull();
  });

  it('matches a single rule and returns its tier', () => {
    const rules = [tierRule({ tools: ['bash'], commandPattern: '^rm', riskTier: 'critical' })];
    const got = evaluateRiskTier(rules, 'bash', { command: 'rm -rf foo' });
    expect(got?.tier).toBe('critical');
  });

  it('returns the highest-rank tier when multiple rules match', () => {
    const rules = [
      tierRule({ id: 'lo', riskTier: 'low' }),
      tierRule({ id: 'hi', riskTier: 'high' }),
      tierRule({ id: 'med', riskTier: 'medium' }),
    ];
    const got = evaluateRiskTier(rules, 'bash', { command: 'anything' });
    expect(got?.tier).toBe('high');
  });

  it('does not match a tool name that is not in the rule’s tools list', () => {
    const rules = [tierRule({ tools: ['bash'], riskTier: 'critical' })];
    const got = evaluateRiskTier(rules, 'read_file', { path: 'foo.ts' });
    expect(got).toBeNull();
  });

  it('ignores disabled rules', () => {
    const rules: GuardRule[] = [{ ...tierRule({ riskTier: 'critical' }), enabled: false }];
    expect(evaluateRiskTier(rules, 'bash', { command: 'x' })).toBeNull();
  });

  it('does not pull in pattern rules', () => {
    const rules: GuardRule[] = [
      {
        id: 'p',
        enabled: true,
        kind: 'pattern',
        description: 'block rm',
        tools: ['bash'],
        commandPattern: '^rm',
        action: 'block',
        message: 'no rm',
      },
    ];
    expect(evaluateRiskTier(rules, 'bash', { command: 'rm -rf foo' })).toBeNull();
  });
});

describe('evaluateGuardrails — backwards compat after schema refactor', () => {
  it('still matches a legacy pattern rule (no `kind` field)', () => {
    // Simulate a stored rule from before Phase 2: no `kind` discriminator.
    const legacy = {
      id: 'p1',
      enabled: true,
      description: 'block rm',
      tools: ['bash'],
      commandPattern: '^rm',
      action: 'block',
      message: 'no rm',
    } as unknown as GuardRule;
    const got = evaluateGuardrails([legacy], 'bash', { command: 'rm -rf foo' });
    // Without kind, the rule defaults to 'pattern' and still triggers.
    expect(got.triggered).toBe(true);
    expect(got.rule?.id).toBe('p1');
  });

  it('does not consider risk_tier rules in pattern evaluation', () => {
    const rules = [tierRule({ tools: ['bash'], riskTier: 'critical' })];
    const got = evaluateGuardrails(rules, 'bash', { command: 'rm -rf foo' });
    expect(got.triggered).toBe(false);
  });
});
