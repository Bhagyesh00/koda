import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { trackCd } from '../src/sandbox/shellState.js';

// Regression: the agent loop fell into "cwd: .../ecommerce-site/ecommerce-site/
// ecommerce-site/..." pyramids because trackCd resolved every cd target with
// path.resolve, never checking that the destination existed. The model would
// emit `cd ecommerce-site` while already inside ecommerce-site; one extra
// segment got appended each iteration. This test pins the new behaviour:
// trackCd refuses to descend into a non-existent path.

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'koda-shell-cwd-test-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('trackCd cwd-existence guard', () => {
  it('descends into a real subdirectory', () => {
    const sub = path.join(tmpRoot, 'real');
    fs.mkdirSync(sub);
    const out = trackCd('cd real', tmpRoot);
    expect(out.cwd).toBe(sub);
    expect(out.warnings).toEqual([]);
  });

  it('refuses to descend into a non-existent directory and warns', () => {
    const out = trackCd('cd ghost', tmpRoot);
    expect(out.cwd).toBe(tmpRoot);                        // unchanged
    expect(out.warnings.length).toBe(1);
    expect(out.warnings[0]).toContain('does not exist');
  });

  it('refuses repeated cd into the same non-existent name (the compounding bug)', () => {
    // Simulate the user-reported failure: model emits `cd ecommerce-site`
    // 9 times in a row. With the guard, cwd never compounds.
    let state = { cwd: tmpRoot, warnings: [] as string[] };
    for (let i = 0; i < 9; i++) {
      state = trackCd('cd ecommerce-site', state.cwd);
    }
    expect(state.cwd).toBe(tmpRoot);
    // Each iteration adds exactly one warning.
    expect(state.warnings.length).toBe(1);
  });

  it('refuses cd into a file (not a directory)', () => {
    const f = path.join(tmpRoot, 'a-file.txt');
    fs.writeFileSync(f, 'hello');
    const out = trackCd('cd a-file.txt', tmpRoot);
    expect(out.cwd).toBe(tmpRoot);
    expect(out.warnings[0]).toContain('not a directory');
  });

  it('handles chained `cd a && cd b` — only valid hops advance', () => {
    const a = path.join(tmpRoot, 'a');
    fs.mkdirSync(a);
    // 'b' does not exist
    const out = trackCd('cd a && cd b', tmpRoot);
    expect(out.cwd).toBe(a);                  // advanced to a
    expect(out.warnings.length).toBe(1);
    expect(out.warnings[0]).toContain("'b'");
  });

  it('returns no warnings when there is no cd in the command', () => {
    const out = trackCd('ls -la', tmpRoot);
    expect(out.cwd).toBe(tmpRoot);
    expect(out.warnings).toEqual([]);
  });

  it('cd .. behaves like a real shell when parent exists', () => {
    const sub = path.join(tmpRoot, 'sub');
    fs.mkdirSync(sub);
    const out = trackCd('cd ..', sub);
    expect(out.cwd).toBe(tmpRoot);
    expect(out.warnings).toEqual([]);
  });
});
