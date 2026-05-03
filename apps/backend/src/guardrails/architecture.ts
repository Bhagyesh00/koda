import path from 'node:path';
import fs from 'node:fs';
import { minimatch } from 'minimatch';
import type { GuardRule, ArchitectureRule } from '@koda/shared';

/**
 * Architectural Linter (Phase 2).
 *
 * Enforces user-declared layer/edge constraints on file writes. A layer is a
 * named glob pattern; an edge is an *allowed* import (`from` may import `to`).
 * Any import that crosses layers without an explicit edge is a violation.
 *
 * Imports outside any declared layer (e.g. node_modules, third-party packages,
 * unmapped files) are ignored — only intra-project edges are policed.
 */

export interface ArchitectureViolation {
  ruleId: string;
  ruleDescription: string;
  action: 'block' | 'warn';
  fromLayer: string;
  toLayer: string;
  importStatement: string;
  filePath: string;
}

const IMPORT_REGEX =
  /(?:^|[^.\w])(?:import\s+(?:[\s\S]*?from\s+)?|require\s*\(\s*|export\s+[\s\S]*?from\s+)['"]([^'"]+)['"]/g;

const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function isCodeFile(p: string): boolean {
  return CODE_EXTS.has(path.extname(p).toLowerCase());
}

/** Parse import specifiers from a file's source — best-effort, regex-based. */
export function parseImports(source: string): string[] {
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  IMPORT_REGEX.lastIndex = 0;
  while ((m = IMPORT_REGEX.exec(source)) !== null) {
    if (m[1]) seen.add(m[1]);
  }
  return Array.from(seen);
}

/**
 * Resolve an import specifier to a workspace-relative path *if* it points
 * inside the workspace. Returns null for bare module specifiers (no ./ or ../).
 */
function resolveImport(
  importer: string,
  spec: string,
  workDir: string,
): string | null {
  // Bare module — not a project file, not architecturally relevant.
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null;
  const importerAbs = path.isAbsolute(importer) ? importer : path.join(workDir, importer);
  const importerDir = path.dirname(importerAbs);
  const resolved = path.isAbsolute(spec) ? spec : path.resolve(importerDir, spec);
  // Try resolved path itself, then with each code extension, then /index.<ext>.
  const candidates = [resolved];
  for (const ext of CODE_EXTS) candidates.push(resolved + ext);
  for (const ext of CODE_EXTS) candidates.push(path.join(resolved, `index${ext}`));
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        return path.relative(workDir, c).replace(/\\/g, '/');
      }
    } catch {
      /* not readable, keep trying */
    }
  }
  // Fall back to the unresolved relative path so the layer matcher still gets
  // something to work with (lets us catch edges to files that don't exist yet).
  return path.relative(workDir, resolved).replace(/\\/g, '/');
}

/**
 * Find which layer a workspace-relative path belongs to. Returns null if it
 * doesn't match any declared layer — those imports are exempt from policing.
 */
export function pathToLayer(relPath: string, layers: ArchitectureRule['layers']): string | null {
  for (const [layer, patterns] of Object.entries(layers)) {
    for (const p of patterns) {
      if (minimatch(relPath, p, { dot: true })) return layer;
    }
  }
  return null;
}

/**
 * Evaluate architecture rules for a write/edit on `targetPath` whose final
 * content will be `content`. Returns all violations (one per disallowed edge).
 *
 * `targetPath` may be relative to workDir or absolute — both are supported.
 */
export function evaluateArchitecture(
  rules: GuardRule[],
  workDir: string,
  targetPath: string,
  content: string,
): ArchitectureViolation[] {
  if (!isCodeFile(targetPath)) return [];
  const archRules = rules.filter(
    (r) => r.enabled && r.kind === 'architecture' && r.architecture && (r.action === 'block' || r.action === 'warn'),
  );
  if (archRules.length === 0) return [];

  const targetAbs = path.isAbsolute(targetPath) ? targetPath : path.join(workDir, targetPath);
  const targetRel = path.relative(workDir, targetAbs).replace(/\\/g, '/');
  const imports = parseImports(content);
  const violations: ArchitectureViolation[] = [];

  for (const rule of archRules) {
    const arch = rule.architecture!;
    const fromLayer = pathToLayer(targetRel, arch.layers);
    if (!fromLayer) continue; // The file itself isn't in any policed layer.
    const allowed = new Set(
      arch.edges.filter((e) => e.from === fromLayer).map((e) => e.to),
    );
    for (const spec of imports) {
      const resolved = resolveImport(targetRel, spec, workDir);
      if (!resolved) continue;
      const toLayer = pathToLayer(resolved, arch.layers);
      if (!toLayer || toLayer === fromLayer) continue; // intra-layer is always OK
      if (!allowed.has(toLayer)) {
        violations.push({
          ruleId: rule.id,
          ruleDescription: rule.description,
          action: rule.action === 'block' ? 'block' : 'warn',
          fromLayer,
          toLayer,
          importStatement: spec,
          filePath: targetRel,
        });
      }
    }
  }

  return violations;
}
