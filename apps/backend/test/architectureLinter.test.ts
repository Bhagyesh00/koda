import { describe, it, expect } from 'vitest';
import {
  parseImports,
  pathToLayer,
  evaluateArchitecture,
} from '../src/guardrails/architecture.js';
import type { GuardRule } from '@koda/shared';

// Phase 2 — Architectural Linter regression tests. Validates the import
// parser, layer-matching, and edge enforcement against fabricated rules.

describe('parseImports', () => {
  it('finds ES module imports', () => {
    const src = `import x from './a';\nimport { y } from "../b";\nexport { z } from "./c";`;
    const got = parseImports(src);
    expect(got).toContain('./a');
    expect(got).toContain('../b');
    expect(got).toContain('./c');
  });

  it('finds CommonJS requires', () => {
    const src = `const x = require("./mod");\nconst y = require('./other');`;
    const got = parseImports(src);
    expect(got).toContain('./mod');
    expect(got).toContain('./other');
  });

  it('deduplicates the same specifier', () => {
    const src = `import a from './x';\nimport b from './x';`;
    expect(parseImports(src)).toEqual(['./x']);
  });

  it('returns empty for sources with no imports', () => {
    expect(parseImports('const x = 1;')).toEqual([]);
  });
});

describe('pathToLayer', () => {
  const layers = {
    api: ['src/api/**'],
    core: ['src/core/**', 'src/domain/**'],
  };

  it('matches a path to its layer', () => {
    expect(pathToLayer('src/api/users.ts', layers)).toBe('api');
    expect(pathToLayer('src/core/db.ts', layers)).toBe('core');
    expect(pathToLayer('src/domain/order.ts', layers)).toBe('core');
  });

  it('returns null for paths outside any layer', () => {
    expect(pathToLayer('node_modules/lodash/index.js', layers)).toBeNull();
    expect(pathToLayer('scripts/build.ts', layers)).toBeNull();
  });
});

function archRule(opts: {
  layers: Record<string, string[]>;
  edges: Array<{ from: string; to: string }>;
  action?: 'block' | 'warn';
  description?: string;
}): GuardRule {
  return {
    id: 'arch-1',
    enabled: true,
    description: opts.description ?? 'layered',
    kind: 'architecture',
    tools: ['write_file', 'edit_file'],
    action: opts.action ?? 'block',
    message: 'arch violation',
    architecture: { layers: opts.layers, edges: opts.edges },
  };
}

describe('evaluateArchitecture', () => {
  const workDir = '/proj';

  it('returns no violations when the edge is allowed', () => {
    const rules = [
      archRule({
        layers: { api: ['src/api/**'], core: ['src/core/**'] },
        edges: [{ from: 'api', to: 'core' }],
      }),
    ];
    const violations = evaluateArchitecture(
      rules,
      workDir,
      'src/api/users.ts',
      `import { getUser } from '../core/db';`,
    );
    expect(violations).toEqual([]);
  });

  it('flags an import that crosses layers without an edge', () => {
    const rules = [
      archRule({
        layers: { api: ['src/api/**'], core: ['src/core/**'] },
        edges: [{ from: 'api', to: 'core' }], // reverse (core → api) is NOT allowed
      }),
    ];
    const violations = evaluateArchitecture(
      rules,
      workDir,
      'src/core/db.ts',
      `import { handler } from '../api/users';`,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.fromLayer).toBe('core');
    expect(violations[0]?.toLayer).toBe('api');
    expect(violations[0]?.action).toBe('block');
  });

  it('ignores intra-layer imports', () => {
    const rules = [
      archRule({
        layers: { core: ['src/core/**'] },
        edges: [],
      }),
    ];
    const violations = evaluateArchitecture(
      rules,
      workDir,
      'src/core/a.ts',
      `import { b } from './b';`,
    );
    expect(violations).toEqual([]);
  });

  it('ignores imports of bare module specifiers (third-party)', () => {
    const rules = [
      archRule({
        layers: { api: ['src/api/**'] },
        edges: [],
      }),
    ];
    const violations = evaluateArchitecture(
      rules,
      workDir,
      'src/api/users.ts',
      `import express from 'express';\nimport { z } from 'zod';`,
    );
    expect(violations).toEqual([]);
  });

  it('ignores files that are not in any policed layer', () => {
    const rules = [
      archRule({
        layers: { core: ['src/core/**'] },
        edges: [],
      }),
    ];
    const violations = evaluateArchitecture(
      rules,
      workDir,
      'scripts/build.ts',
      `import x from '../src/core/a';`,
    );
    expect(violations).toEqual([]);
  });

  it('skips non-code files entirely', () => {
    const rules = [
      archRule({
        layers: { docs: ['docs/**'] },
        edges: [],
      }),
    ];
    expect(
      evaluateArchitecture(rules, workDir, 'docs/README.md', 'whatever'),
    ).toEqual([]);
  });

  it('respects warn-action rules (returns violation but action=warn)', () => {
    const rules = [
      archRule({
        layers: { api: ['src/api/**'], core: ['src/core/**'] },
        edges: [{ from: 'api', to: 'core' }],
        action: 'warn',
      }),
    ];
    const violations = evaluateArchitecture(
      rules,
      workDir,
      'src/core/db.ts',
      `import x from '../api/users';`,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.action).toBe('warn');
  });

  it('skips disabled architecture rules', () => {
    const rules: GuardRule[] = [
      { ...archRule({ layers: { a: ['x/**'] }, edges: [] }), enabled: false },
    ];
    expect(
      evaluateArchitecture(rules, workDir, 'x/y.ts', 'import z from "../w/v";'),
    ).toEqual([]);
  });
});
