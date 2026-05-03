import { describe, it, expect } from 'vitest';
import {
  parseContribution,
  resolveAgentSkill,
  buildAgentSystemPrompt,
  buildSynthesisPrompt,
  aggregateBlackboard,
  renderAggregation,
  type BlackboardEntry,
  type Contribution,
} from '../src/tools/multiAgent.helpers.js';

// Phase 4 — Multi-Agent Structured Debate.
// Helpers are unit-testable without Ollama; the LLM-driven orchestrator
// itself is covered by manual smoke tests.

// ── parseContribution ────────────────────────────────────────────────────────

describe('parseContribution', () => {
  it('parses a fenced ```json block', () => {
    const raw = 'thinking out loud...\n\n```json\n{"claim":"X","evidence":["a"],"confidence":80,"dissents":[]}\n```\n\nthat\'s my take.';
    const parsed = parseContribution(raw);
    expect(parsed?.claim).toBe('X');
    expect(parsed?.evidence).toEqual(['a']);
    expect(parsed?.confidence).toBe(80);
  });

  it('falls back to bare {…} when no fence', () => {
    const raw = 'preamble\n{"claim":"Y","evidence":[],"confidence":50,"dissents":[]}\n';
    const parsed = parseContribution(raw);
    expect(parsed?.claim).toBe('Y');
  });

  it('handles dissents with nested objects', () => {
    const raw = '```json\n' + JSON.stringify({
      claim: 'reject the design',
      evidence: ['blastRadius.ts:47'],
      confidence: 70,
      dissents: [{ targetRole: 'qa', targetClaim: 'tests are enough', reason: 'no fuzz coverage' }],
    }) + '\n```';
    const parsed = parseContribution(raw);
    expect(parsed?.dissents).toHaveLength(1);
    expect(parsed?.dissents[0]?.targetRole).toBe('qa');
  });

  it('returns null on garbage', () => {
    expect(parseContribution('hello world no json here')).toBeNull();
  });

  it('returns null when JSON parses but the schema is wrong', () => {
    expect(parseContribution('```json\n{"foo": 1}\n```')).toBeNull();
  });

  it('does not get tripped up by braces inside string values', () => {
    const raw = '```json\n{"claim":"use { } notation","evidence":[],"confidence":50,"dissents":[]}\n```';
    expect(parseContribution(raw)?.claim).toBe('use { } notation');
  });
});

// ── resolveAgentSkill ────────────────────────────────────────────────────────

describe('resolveAgentSkill', () => {
  it('honours an explicit skill slug', () => {
    const got = resolveAgentSkill({ role: 'whatever', skill: 'senior-security-engineer' });
    expect(got).toBeDefined();
    expect(got).toContain('Security');
  });

  it('aliases common short role names', () => {
    expect(resolveAgentSkill({ role: 'security' })).toBeDefined();
    expect(resolveAgentSkill({ role: 'qa' })).toBeDefined();
    expect(resolveAgentSkill({ role: 'performance' })).toBeDefined();
    expect(resolveAgentSkill({ role: 'architecture' })).toBeDefined();
  });

  it('is case-insensitive', () => {
    expect(resolveAgentSkill({ role: 'Security' })).toBeDefined();
    expect(resolveAgentSkill({ role: 'QA' })).toBeDefined();
  });

  it('returns undefined for unknown roles with no alias', () => {
    expect(resolveAgentSkill({ role: 'plumber' })).toBeUndefined();
  });
});

// ── buildAgentSystemPrompt ───────────────────────────────────────────────────

describe('buildAgentSystemPrompt', () => {
  const base = {
    goal: 'choose a database',
    role: 'security',
    userPrompt: 'pick',
    round: 1,
    maxRounds: 3,
    blackboard: [],
    structured: true,
  };

  it('includes the role, goal, and round', () => {
    const out = buildAgentSystemPrompt(base);
    expect(out).toContain('"security"');
    expect(out).toContain('choose a database');
    expect(out).toContain('Round: 1 of 3');
  });

  it('embeds the structured-output instruction in structured mode', () => {
    const out = buildAgentSystemPrompt(base);
    expect(out).toMatch(/SINGLE JSON object inside a/);
    expect(out).toContain('"dissents"');
  });

  it('omits the JSON instruction in free-form mode', () => {
    const out = buildAgentSystemPrompt({ ...base, structured: false });
    expect(out).not.toMatch(/SINGLE JSON object/);
  });

  it('prepends the resolved skill prompt addition', () => {
    const out = buildAgentSystemPrompt({ ...base, role: 'security' });
    expect(out).toContain('Security Engineer');
  });

  it('renders structured prior contributions on the blackboard', () => {
    const board: BlackboardEntry[] = [
      {
        agentRole: 'qa',
        round: 1,
        ts: 0,
        raw: 'raw output',
        parsed: true,
        structured: {
          claim: 'tests look fine',
          evidence: ['x.test.ts'],
          confidence: 60,
          dissents: [],
        },
      },
    ];
    const out = buildAgentSystemPrompt({ ...base, round: 2, blackboard: board });
    expect(out).toContain('[qa · round 1 · confidence 60]');
    expect(out).toContain('claim: tests look fine');
    expect(out).toContain('evidence: x.test.ts');
  });
});

// ── buildSynthesisPrompt ─────────────────────────────────────────────────────

describe('buildSynthesisPrompt', () => {
  it('embeds the goal and asks for the four canonical sections', () => {
    const out = buildSynthesisPrompt({
      goal: 'pick auth strategy',
      blackboard: [],
    });
    expect(out).toContain('Goal: pick auth strategy');
    expect(out).toContain('## Consensus');
    expect(out).toContain('## Disputes');
    expect(out).toContain('## Final recommendation');
    expect(out).toContain('## Open questions');
  });
});

// ── aggregateBlackboard + renderAggregation ──────────────────────────────────

function entry(opts: Partial<BlackboardEntry> & { agentRole: string; round: number; structured: Contribution }): BlackboardEntry {
  return {
    ts: 0,
    raw: '',
    parsed: true,
    ...opts,
  };
}

describe('aggregateBlackboard', () => {
  it('counts parsed vs unparsed and rounds correctly', () => {
    const board: BlackboardEntry[] = [
      entry({ agentRole: 'a', round: 1, structured: { claim: 'A', evidence: [], confidence: 50, dissents: [] } }),
      { agentRole: 'b', round: 1, ts: 0, raw: 'free-form', parsed: false },
      entry({ agentRole: 'a', round: 2, structured: { claim: 'A', evidence: [], confidence: 70, dissents: [] } }),
    ];
    const agg = aggregateBlackboard(board);
    expect(agg.totalContributions).toBe(3);
    expect(agg.parsedContributions).toBe(2);
    expect(agg.rounds).toBe(2);
  });

  it('reports consensus when 2+ distinct roles share a claim', () => {
    const board: BlackboardEntry[] = [
      entry({ agentRole: 'security', round: 1, structured: { claim: 'use Argon2', evidence: [], confidence: 80, dissents: [] } }),
      entry({ agentRole: 'backend', round: 1, structured: { claim: 'Use Argon2', evidence: [], confidence: 70, dissents: [] } }), // case-insensitive match
    ];
    const agg = aggregateBlackboard(board);
    expect(agg.consensus).toHaveLength(1);
    expect(agg.consensus[0]?.supportingRoles.sort()).toEqual(['backend', 'security']);
    expect(agg.consensus[0]?.avgConfidence).toBe(75);
  });

  it('does not report consensus when only one role makes the claim', () => {
    const board: BlackboardEntry[] = [
      entry({ agentRole: 'security', round: 1, structured: { claim: 'lonely claim', evidence: [], confidence: 80, dissents: [] } }),
      entry({ agentRole: 'security', round: 2, structured: { claim: 'lonely claim', evidence: [], confidence: 90, dissents: [] } }),
    ];
    expect(aggregateBlackboard(board).consensus).toHaveLength(0);
  });

  it('groups dissents by target', () => {
    const board: BlackboardEntry[] = [
      entry({
        agentRole: 'security',
        round: 1,
        structured: {
          claim: 'X',
          evidence: [],
          confidence: 60,
          dissents: [{ targetRole: 'qa', targetClaim: 'all green', reason: 'no fuzzing' }],
        },
      }),
      entry({
        agentRole: 'devops',
        round: 1,
        structured: {
          claim: 'Y',
          evidence: [],
          confidence: 70,
          dissents: [{ targetRole: 'qa', targetClaim: 'all green', reason: 'no chaos tests' }],
        },
      }),
    ];
    const agg = aggregateBlackboard(board);
    expect(agg.disputes).toHaveLength(1);
    expect(agg.disputes[0]?.dissents).toHaveLength(2);
    expect(agg.disputes[0]?.dissents.map((d) => d.fromRole).sort()).toEqual(['devops', 'security']);
  });
});

describe('renderAggregation', () => {
  it('produces a markdown report including consensus and disputes', () => {
    const md = renderAggregation({
      totalContributions: 3,
      parsedContributions: 3,
      rounds: 2,
      consensus: [{ claim: 'use HTTPS', supportingRoles: ['security', 'devops'], avgConfidence: 90 }],
      disputes: [
        {
          targetRole: 'qa',
          targetClaim: 'CI is fine',
          dissents: [{ fromRole: 'security', reason: 'no SAST step' }],
        },
      ],
    });
    expect(md).toContain('### Debate stats');
    expect(md).toContain('### Consensus');
    expect(md).toContain('use HTTPS');
    expect(md).toContain('### Disputes');
    expect(md).toContain('no SAST step');
  });

  it('omits empty sections', () => {
    const md = renderAggregation({
      totalContributions: 1,
      parsedContributions: 1,
      rounds: 1,
      consensus: [],
      disputes: [],
    });
    expect(md).not.toContain('### Consensus');
    expect(md).not.toContain('### Disputes');
    expect(md).toContain('### Debate stats');
  });
});
