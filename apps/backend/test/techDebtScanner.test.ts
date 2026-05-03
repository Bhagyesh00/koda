import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanLargeFiles, scanTodoMarkers, scanDuplication } from '../src/techDebt/scanner.js';

// Phase 5 — Tech Debt Scanner regression tests. Covers the deterministic
// scanners (large-file / TODO / duplication) against a temp workspace.
// Vulnerability scanning is excluded — it depends on a real package manager
// and is exercised manually.

let tmpRoot: string;

const SCAN_ID = 'test-scan-1';

function w(rel: string, content: string) {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'koda-techdebt-'));
});

afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('scanLargeFiles', () => {
  it('flags files exceeding the 800-line threshold', async () => {
    w('big.ts', Array.from({ length: 900 }, (_, i) => `const x${i} = ${i};`).join('\n'));
    w('small.ts', 'export const a = 1;');
    const findings = await scanLargeFiles(tmpRoot, ['big.ts', 'small.ts'], SCAN_ID);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.filePath).toBe('big.ts');
    expect(findings[0]?.severity).toBe('medium');
    expect(findings[0]?.meta?.lineCount).toBeGreaterThanOrEqual(900);
  });

  it('marks files >= 2000 lines as high severity', async () => {
    w('huge.ts', Array.from({ length: 2100 }, (_, i) => `// ${i}`).join('\n'));
    const findings = await scanLargeFiles(tmpRoot, ['huge.ts'], SCAN_ID);
    expect(findings[0]?.severity).toBe('high');
  });

  it('ignores non-code extensions', async () => {
    w('notes.md', Array.from({ length: 1500 }, (_, i) => `line ${i}`).join('\n'));
    const findings = await scanLargeFiles(tmpRoot, ['notes.md'], SCAN_ID);
    expect(findings).toEqual([]);
  });
});

describe('scanTodoMarkers', () => {
  it('finds TODO/FIXME/HACK lines and assigns severity', async () => {
    w('a.ts', [
      'export const x = 1;',
      '// TODO: rename this',
      'export const y = 2;',
      '// FIXME: this is broken',
      '// HACK: working around legacy bug',
      '// XXX: revisit when cluster is sharded',
      'export const z = 3;',
    ].join('\n'));

    const findings = await scanTodoMarkers(tmpRoot, ['a.ts'], SCAN_ID);
    expect(findings).toHaveLength(4);
    const todo = findings.find((f) => f.meta?.marker === 'TODO');
    const fixme = findings.find((f) => f.meta?.marker === 'FIXME');
    const hack = findings.find((f) => f.meta?.marker === 'HACK');
    const xxx = findings.find((f) => f.meta?.marker === 'XXX');
    expect(todo?.severity).toBe('low');
    expect(fixme?.severity).toBe('medium');
    expect(hack?.severity).toBe('medium');
    expect(xxx?.severity).toBe('medium');
  });

  it('reports correct line numbers (1-indexed)', async () => {
    w('b.ts', 'const a = 1;\nconst b = 2;\n// TODO: third line\nconst c = 3;');
    const findings = await scanTodoMarkers(tmpRoot, ['b.ts'], SCAN_ID);
    expect(findings[0]?.line).toBe(3);
  });

  it('skips non-code files even if they contain markers', async () => {
    w('readme.md', '# README\n\nTODO: write docs');
    const findings = await scanTodoMarkers(tmpRoot, ['readme.md'], SCAN_ID);
    expect(findings).toEqual([]);
  });
});

describe('scanDuplication', () => {
  it('flags files whose first 20 meaningful lines match', async () => {
    const body = Array.from({ length: 25 }, (_, i) => `const v${i} = ${i};`).join('\n');
    w('dup-a.ts', body);
    w('dup-b.ts', body);
    w('different.ts', 'export const unique = "yes";\n' + Array.from({ length: 25 }, (_, i) => `let q${i} = ${i};`).join('\n'));

    const findings = await scanDuplication(
      tmpRoot,
      ['dup-a.ts', 'dup-b.ts', 'different.ts'],
      SCAN_ID,
    );
    // Both duplicate files report the duplication; the unique file does not.
    expect(findings.filter((f) => f.filePath === 'dup-a.ts')).toHaveLength(1);
    expect(findings.filter((f) => f.filePath === 'dup-b.ts')).toHaveLength(1);
    expect(findings.filter((f) => f.filePath === 'different.ts')).toHaveLength(0);
  });

  it('does not flag files with fewer than 20 meaningful lines', async () => {
    w('short-a.ts', 'export const x = 1;');
    w('short-b.ts', 'export const x = 1;');
    const findings = await scanDuplication(tmpRoot, ['short-a.ts', 'short-b.ts'], SCAN_ID);
    expect(findings).toEqual([]);
  });
});
