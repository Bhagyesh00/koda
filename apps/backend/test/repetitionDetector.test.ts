import { describe, it, expect } from 'vitest';
import { RepetitionDetector } from '../src/agent/repetitionDetector.js';

// Stream-side guard against degenerate LLM repetition loops.
// The detector runs two checks in parallel:
//   1. Run-length: 5 IDENTICAL long lines back-to-back → trip.
//   2. Cycle: across the last 10 long lines, ≤3 unique values → trip.

describe('RepetitionDetector — run-length detector', () => {
  it('returns false for normal varied output', () => {
    const d = new RepetitionDetector();
    const lines = [
      'Reading apps/backend/src/index.ts',
      'Found the bug — it is at line 42',
      'Applying the fix now',
      'Tests passing',
      'Committing the change',
    ].join('\n') + '\n';
    expect(d.feed(lines)).toBe(false);
  });

  it('trips after 5 consecutive identical long lines', () => {
    const d = new RepetitionDetector();
    const repeat = 'Wait, I will just run it.\n';
    let trippedAt = -1;
    for (let i = 0; i < 10; i++) {
      if (d.feed(repeat)) { trippedAt = i; break; }
    }
    expect(trippedAt).toBe(4);
    expect(d.triggeringLine()).toBe('Wait, I will just run it.');
    expect(d.triggeringReason()).toBe('run');
  });

  it('ignores short repeated lines (avoids false-positive on bullet/punct)', () => {
    const d = new RepetitionDetector();
    const shortRepeat = 'Done\nDone\nDone\nDone\nDone\nDone\nDone\nDone\n';
    expect(d.feed(shortRepeat)).toBe(false);
  });

  it('does NOT reset on a single short line (paragraph break) — still trips', () => {
    // Old behaviour: any <12-char line wiped the run window.  That meant a
    // blank line between repeats hid the loop entirely.  New behaviour:
    // short lines are skipped, the run keeps accumulating across them.
    const d = new RepetitionDetector();
    const lines = [
      'This is a long repeated thinking line.',
      '',  // blank
      'This is a long repeated thinking line.',
      'OK',  // short
      'This is a long repeated thinking line.',
      'This is a long repeated thinking line.',
      'This is a long repeated thinking line.',
    ].join('\n') + '\n';
    expect(d.feed(lines)).toBe(true);
    expect(d.triggeringReason()).toBe('run');
  });

  it('a different long line between repeats DOES break the run streak', () => {
    const d = new RepetitionDetector();
    const lines = [
      'Wait, I will just run it.',
      'Wait, I will just run it.',
      'Wait, I will just run it.',
      'Now actually doing the work.',
      'Wait, I will just run it.',
      'Wait, I will just run it.',
      'Wait, I will just run it.',
    ].join('\n') + '\n';
    // Run window of 5 ends as [Now, Wait, Wait, Wait, Wait] — not all identical.
    // Cycle window has 7 entries, < 10, so cycle detector doesn't fire either.
    expect(d.feed(lines)).toBe(false);
  });

  it('handles incremental chunked input (real streaming case)', () => {
    const d = new RepetitionDetector();
    const phrase = 'Wait, I will just run it.\n';
    let tripped = false;
    outer: for (let rep = 0; rep < 10; rep++) {
      for (const ch of phrase) {
        if (d.feed(ch)) { tripped = true; break outer; }
      }
    }
    expect(tripped).toBe(true);
  });

  it('triggeringLine / triggeringReason return null until the trap fires', () => {
    const d = new RepetitionDetector();
    expect(d.triggeringLine()).toBeNull();
    expect(d.triggeringReason()).toBeNull();
    d.feed('Different long enough line one\n');
    d.feed('Different long enough line two\n');
    expect(d.triggeringLine()).toBeNull();
    expect(d.triggeringReason()).toBeNull();
  });
});

describe('RepetitionDetector — cycle detector', () => {
  // Reproduces the user-reported failure: a 3-line A/B/C cycle that the
  // run-length check missed because no 5 consecutive lines were identical.
  it('trips on a 3-line cycle (the "fix this project" failure mode)', () => {
    const d = new RepetitionDetector();
    const cycle = [
      "Wait, I'll check src/app/page.tsx and see if it's importing anything that doesn't exist.",
      "Actually, I'll just run npm run build and see the error. I'll use bash.",
      "(I'll try to run the build and see the error).",
    ];
    let tripped = false;
    // Feed the cycle until the detector trips.
    for (let i = 0; i < 30 && !tripped; i++) {
      const line = cycle[i % cycle.length] + '\n';
      if (d.feed(line)) tripped = true;
    }
    expect(tripped).toBe(true);
    expect(d.triggeringReason()).toBe('cycle');
    // The triggering line should be one of the three cycle members.
    expect(cycle).toContain(d.triggeringLine());
  });

  it('trips on a 2-line A/B/A/B/... cycle', () => {
    const d = new RepetitionDetector();
    const a = 'I will read the file to understand it.\n';
    const b = 'Actually, let me run the build first to see errors.\n';
    let tripped = false;
    for (let i = 0; i < 20 && !tripped; i++) {
      if (d.feed(i % 2 === 0 ? a : b)) tripped = true;
    }
    expect(tripped).toBe(true);
    expect(d.triggeringReason()).toBe('cycle');
  });

  it('does NOT trip on 5 distinct varied lines followed by 5 more distinct ones', () => {
    const d = new RepetitionDetector();
    const lines = [
      'Reading the package.json to understand dependencies',
      'Looking for the entry point in src/index.ts',
      'Found the main export — it is the App component',
      'Now checking how it is wired into the router',
      'The router uses lazy loading for sub-routes',
      'Identified the slow component as DataGrid',
      'It re-renders on every prop change due to inline lambdas',
      'I can fix this by memoising the row renderer',
      'Wrapping the renderer with useCallback now',
      'Verifying the fix did not break any tests',
    ].map((s) => s + '\n').join('');
    expect(d.feed(lines)).toBe(false);
  });

  it('once tripped, stays tripped on subsequent feeds (idempotent)', () => {
    const d = new RepetitionDetector();
    const repeat = 'This is a long repeated thinking line.\n';
    for (let i = 0; i < 5; i++) d.feed(repeat);
    expect(d.feed('a fresh line that should not unstick the trap\n')).toBe(true);
  });
});
