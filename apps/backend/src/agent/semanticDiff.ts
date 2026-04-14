/**
 * Lightweight regex-based semantic diff that produces a natural-language
 * summary of code changes without needing tree-sitter.
 *
 * Extracts symbol counts (functions, classes, imports, exports) before and
 * after, then describes the delta.
 */

interface SymbolCounts {
  functions: Set<string>;
  classes: Set<string>;
  imports: Set<string>;
  exports: Set<string>;
  lines: number;
}

function extractSymbols(src: string): SymbolCounts {
  const functions = new Set<string>();
  const classes = new Set<string>();
  const imports = new Set<string>();
  const exports = new Set<string>();

  // function declarations: function foo(...), const foo = (...) =>, const foo = async (...) =>
  for (const m of src.matchAll(/function\s+(\w+)/g)) functions.add(m[1]!);
  for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\(|function)/g)) {
    functions.add(m[1]!);
  }
  // ES6 methods in classes/objects: foo(...) {
  for (const m of src.matchAll(/^\s{2,}(\w+)\s*\([^)]*\)\s*\{/gm)) functions.add(m[1]!);

  for (const m of src.matchAll(/class\s+(\w+)/g)) classes.add(m[1]!);
  for (const m of src.matchAll(/^\s*import\s+.*?from\s+['"]([^'"]+)['"]/gm)) imports.add(m[1]!);
  for (const m of src.matchAll(/^\s*export\s+(?:default\s+)?(?:const|let|var|function|class)?\s*(\w+)?/gm)) {
    if (m[1]) exports.add(m[1]);
  }

  return {
    functions,
    classes,
    imports,
    exports,
    lines: src.split('\n').length,
  };
}

function setDiff<T>(a: Set<T>, b: Set<T>): { added: T[]; removed: T[]; kept: T[] } {
  const added: T[] = [];
  const removed: T[] = [];
  const kept: T[] = [];
  for (const x of b) (a.has(x) ? kept : added).push(x);
  for (const x of a) if (!b.has(x)) removed.push(x);
  return { added, removed, kept };
}

export interface SemanticDiff {
  summary: string;
  added: number;
  removed: number;
  changed: number;
}

/** Line-level change counts from a raw textual diff. */
function countLineChanges(before: string, after: string): { added: number; removed: number; changed: number } {
  const beforeLines = new Set(before.split('\n'));
  const afterLines = new Set(after.split('\n'));
  let added = 0;
  let removed = 0;
  for (const l of afterLines) if (!beforeLines.has(l)) added++;
  for (const l of beforeLines) if (!afterLines.has(l)) removed++;
  // "Changed" approximation: min of added & removed
  const changed = Math.min(added, removed);
  return { added: added - changed, removed: removed - changed, changed };
}

export function computeSemanticDiff(before: string, after: string): SemanticDiff {
  const sBefore = extractSymbols(before);
  const sAfter = extractSymbols(after);

  const fnDiff = setDiff(sBefore.functions, sAfter.functions);
  const clsDiff = setDiff(sBefore.classes, sAfter.classes);
  const impDiff = setDiff(sBefore.imports, sAfter.imports);
  const expDiff = setDiff(sBefore.exports, sAfter.exports);

  const parts: string[] = [];
  if (fnDiff.added.length) parts.push(`+${fnDiff.added.length} function${fnDiff.added.length > 1 ? 's' : ''}`);
  if (fnDiff.removed.length) parts.push(`-${fnDiff.removed.length} function${fnDiff.removed.length > 1 ? 's' : ''}`);
  if (clsDiff.added.length) parts.push(`+${clsDiff.added.length} class${clsDiff.added.length > 1 ? 'es' : ''}`);
  if (clsDiff.removed.length) parts.push(`-${clsDiff.removed.length} class${clsDiff.removed.length > 1 ? 'es' : ''}`);
  if (impDiff.added.length) parts.push(`+${impDiff.added.length} import${impDiff.added.length > 1 ? 's' : ''}`);
  if (impDiff.removed.length) parts.push(`-${impDiff.removed.length} import${impDiff.removed.length > 1 ? 's' : ''}`);
  if (expDiff.added.length) parts.push(`+${expDiff.added.length} export${expDiff.added.length > 1 ? 's' : ''}`);
  if (expDiff.removed.length) parts.push(`-${expDiff.removed.length} export${expDiff.removed.length > 1 ? 's' : ''}`);

  const lineCounts = countLineChanges(before, after);
  if (parts.length === 0) {
    parts.push(`${lineCounts.added + lineCounts.changed} lines edited, structurally equivalent`);
  }

  return {
    summary: parts.join(', '),
    added: lineCounts.added,
    removed: lineCounts.removed,
    changed: lineCounts.changed,
  };
}
