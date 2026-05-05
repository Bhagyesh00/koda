import { describe, it, expect } from 'vitest';
import {
  buildStrategyResetHint,
  recordToolOutcome,
  STUCK_THRESHOLD,
  FAILURE_WINDOW,
  type FailureRecord,
  type FailureTrackingState,
} from '../src/agent/stuckDetector.js';

// Auto-think / strategy-reset — when 3+ consecutive tool calls fail, the loop
// stops doing per-tool retries and asks the model to step back, identify the
// shared assumption that's breaking, and propose fundamentally different
// approaches.

function fail(tool: string, err: string, ts = 0): FailureRecord {
  return { tool, errorPreview: err, ts };
}

describe('buildStrategyResetHint', () => {
  it('renders all listed failures (numbered) and demands 2-3 alternatives', () => {
    const out = buildStrategyResetHint([
      fail('read_file', 'ENOENT path src/foo.ts'),
      fail('read_file', 'ENOENT path src/bar.ts'),
      fail('glob', 'no matches for pattern src/**/foo.ts'),
    ]);

    expect(out).toContain('<strategy_reset failures="3">');
    expect(out).toContain('1. read_file — ENOENT path src/foo.ts');
    expect(out).toContain('2. read_file — ENOENT path src/bar.ts');
    expect(out).toContain('3. glob — no matches for pattern');
    expect(out).toContain('FUNDAMENTALLY different approaches');
    expect(out).toContain('shared by all the attempts');
    expect(out).toContain('exactly ONE tool call');
  });

  it('truncates long error previews to keep the prompt small', () => {
    const long = 'x'.repeat(2_000);
    const out = buildStrategyResetHint([fail('bash', long)]);
    // Hint stays comfortably small even with a 2 KB error.
    expect(out.length).toBeLessThan(3_000);
  });

  it('keeps the last 5 entries when more are passed', () => {
    const records: FailureRecord[] = [];
    for (let i = 0; i < 10; i++) records.push(fail(`tool_${i}`, `err ${i}`));
    const out = buildStrategyResetHint(records);
    // Latest five (5..9) should appear, earliest (0..4) should not.
    expect(out).toContain('tool_9');
    expect(out).toContain('tool_5');
    expect(out).not.toContain('tool_0');
    expect(out).not.toContain('tool_4');
  });

  it('escalates the message at 5+ failures', () => {
    const lessThan5 = buildStrategyResetHint([
      fail('a', 'e'), fail('b', 'e'), fail('c', 'e'), fail('d', 'e'),
    ]);
    expect(lessThan5).not.toContain('FIFTH failed attempt');

    const fiveOrMore = buildStrategyResetHint([
      fail('a', 'e'), fail('b', 'e'), fail('c', 'e'), fail('d', 'e'), fail('e', 'e'),
    ]);
    expect(fiveOrMore).toContain('FIFTH failed attempt');
    expect(fiveOrMore).toContain('do NOT keep trying');
  });

  it('STUCK_THRESHOLD is 3 by design — verify the loop wires this constant', () => {
    // Documenting the threshold as a test so any change is intentional.
    expect(STUCK_THRESHOLD).toBe(3);
  });
});

// ── recordToolOutcome (loop.ts wiring under unit test) ───────────────────────
//
// QA risk: the loop.ts integration of consecutiveFailures + recentFailures was
// previously inline and untestable. Extracting it as a pure helper means we can
// now verify the entire failure-tracking contract without spinning up Ollama.

function freshState(): FailureTrackingState {
  return { consecutiveFailures: 0, recentFailures: [] };
}

describe('recordToolOutcome', () => {
  it('returns false on success (no reset needed) and resets the counter', () => {
    const s = freshState();
    s.consecutiveFailures = 2;
    const should = recordToolOutcome(s, { ok: true, tool: 'read_file', errorPreview: '', ts: 1 });
    expect(should).toBe(false);
    expect(s.consecutiveFailures).toBe(0);
  });

  it('preserves recentFailures tail on success — for context in any later reset', () => {
    const s = freshState();
    recordToolOutcome(s, { ok: false, tool: 'read_file', errorPreview: 'ENOENT', ts: 1 });
    recordToolOutcome(s, { ok: true, tool: 'read_file', errorPreview: '', ts: 2 });
    expect(s.recentFailures).toHaveLength(1);
    expect(s.consecutiveFailures).toBe(0);
  });

  it('returns false on the first two failures, true on the third (== STUCK_THRESHOLD)', () => {
    const s = freshState();
    expect(recordToolOutcome(s, { ok: false, tool: 'a', errorPreview: 'e1', ts: 1 })).toBe(false);
    expect(recordToolOutcome(s, { ok: false, tool: 'a', errorPreview: 'e2', ts: 2 })).toBe(false);
    expect(recordToolOutcome(s, { ok: false, tool: 'a', errorPreview: 'e3', ts: 3 })).toBe(true);
  });

  it('continues to return true on subsequent failures past the threshold', () => {
    const s = freshState();
    for (let i = 0; i < 6; i++) {
      recordToolOutcome(s, { ok: false, tool: 't', errorPreview: `e${i}`, ts: i });
    }
    expect(s.consecutiveFailures).toBe(6);
    // Next failure should still emit so the user sees an escalated reset.
    expect(recordToolOutcome(s, { ok: false, tool: 't', errorPreview: 'final', ts: 99 })).toBe(true);
  });

  it('caps recentFailures at FAILURE_WINDOW entries (rolling)', () => {
    const s = freshState();
    for (let i = 0; i < FAILURE_WINDOW + 3; i++) {
      recordToolOutcome(s, { ok: false, tool: `tool_${i}`, errorPreview: `e${i}`, ts: i });
    }
    expect(s.recentFailures).toHaveLength(FAILURE_WINDOW);
    // Oldest entries dropped first — tail keeps the most recent.
    expect(s.recentFailures.at(-1)?.tool).toBe(`tool_${FAILURE_WINDOW + 2}`);
    expect(s.recentFailures.at(0)?.tool).toBe(`tool_3`);
  });

  it('a single success after 2 failures means the next failure does NOT trip — counter must zero', () => {
    const s = freshState();
    recordToolOutcome(s, { ok: false, tool: 'a', errorPreview: 'e', ts: 1 });
    recordToolOutcome(s, { ok: false, tool: 'a', errorPreview: 'e', ts: 2 });
    recordToolOutcome(s, { ok: true,  tool: 'a', errorPreview: '',  ts: 3 });
    // Counter at 0; the next single failure must NOT trigger reset (would be a false-positive).
    const next = recordToolOutcome(s, { ok: false, tool: 'a', errorPreview: 'transient', ts: 4 });
    expect(next).toBe(false);
    expect(s.consecutiveFailures).toBe(1);
  });

  it('FAILURE_WINDOW matches the slice used by buildStrategyResetHint', () => {
    // Wiring contract: helper caps the window, hint renderer slices the same.
    expect(FAILURE_WINDOW).toBe(5);
  });
});
