import { describe, it, expect } from 'vitest';
import { jaccardSimilarity, summarizeAction, DRIFT_THRESHOLD } from '../src/agent/drift.js';

// ── jaccardSimilarity ─────────────────────────────────────────────────────────

describe('jaccardSimilarity', () => {
  it('returns 1 for identical strings', () => {
    const s = 'refactor authentication module';
    expect(jaccardSimilarity(s, s)).toBe(1);
  });

  it('returns 0 for empty strings', () => {
    expect(jaccardSimilarity('', '')).toBe(0);
  });

  it('returns 0 when one string is empty', () => {
    expect(jaccardSimilarity('auth login', '')).toBe(0);
    expect(jaccardSimilarity('', 'auth login')).toBe(0);
  });

  it('returns 0 for completely disjoint meaningful words', () => {
    // Deliberately different domains — no shared non-stopword tokens
    const score = jaccardSimilarity('database migration schema', 'render jsx component');
    expect(score).toBe(0);
  });

  it('is symmetric', () => {
    const a = 'refactor login handler';
    const b = 'fix authentication module';
    expect(jaccardSimilarity(a, b)).toBeCloseTo(jaccardSimilarity(b, a), 10);
  });

  it('is case-insensitive', () => {
    expect(jaccardSimilarity('Refactor Module', 'refactor module')).toBe(1);
  });

  it('ignores stopwords when computing similarity', () => {
    // "the" and "a" are stopwords — stripping them should leave same tokens
    expect(jaccardSimilarity('the refactor the module', 'refactor module')).toBe(1);
  });

  it('ignores short words (length <= 2)', () => {
    // "is", "in", "to" are length-2 — filtered out
    expect(jaccardSimilarity('is in to refactor module', 'refactor module')).toBe(1);
  });

  it('returns a value between 0 and 1 for partial overlap', () => {
    const score = jaccardSimilarity('read file authentication', 'write file config');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('strips punctuation before tokenising', () => {
    expect(jaccardSimilarity('auth!module', 'auth module')).toBe(1);
  });
});

// ── DRIFT_THRESHOLD ───────────────────────────────────────────────────────────

describe('DRIFT_THRESHOLD', () => {
  it('is a small positive number well below 0.5', () => {
    expect(DRIFT_THRESHOLD).toBeGreaterThan(0);
    expect(DRIFT_THRESHOLD).toBeLessThan(0.5);
  });

  it('drift is detected when similarity is below threshold', () => {
    // Completely unrelated strings should score below the threshold
    const score = jaccardSimilarity('refactor authentication service', 'database migration schema');
    expect(score).toBeLessThan(DRIFT_THRESHOLD);
  });
});

// ── summarizeAction ───────────────────────────────────────────────────────────

describe('summarizeAction', () => {
  it('always includes the tool name', () => {
    expect(summarizeAction('bash', {})).toContain('bash');
    expect(summarizeAction('read_file', {})).toContain('read_file');
  });

  it('includes path when present', () => {
    const s = summarizeAction('read_file', { path: '/src/auth.ts' });
    expect(s).toContain('/src/auth.ts');
  });

  it('includes pattern when present', () => {
    const s = summarizeAction('glob', { pattern: '**/*.ts' });
    expect(s).toContain('**/*.ts');
  });

  it('includes command when present', () => {
    const s = summarizeAction('bash', { command: 'npm test' });
    expect(s).toContain('npm test');
  });

  it('includes description when present', () => {
    const s = summarizeAction('proof', { description: 'tests pass' });
    expect(s).toContain('tests pass');
  });

  it('truncates long content to 200 chars', () => {
    const longContent = 'x'.repeat(500);
    const s = summarizeAction('write_file', { path: 'f.ts', content: longContent });
    // content slice(0,200) + other parts — total should be much less than 500+
    expect(s.length).toBeLessThan(300);
  });

  it('handles empty args without throwing', () => {
    expect(() => summarizeAction('read_file', {})).not.toThrow();
  });

  it('handles null/undefined args without throwing', () => {
    expect(() => summarizeAction('bash', null)).not.toThrow();
    expect(() => summarizeAction('bash', undefined)).not.toThrow();
  });
});
