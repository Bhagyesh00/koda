/**
 * Regex-based blast radius analyzer: given a file path, walks the workspace
 * and finds which files import or reference it, and which test files cover
 * it by module name.
 *
 * This is coarser than tree-sitter AST analysis but works for any language
 * and catches common patterns.
 */
import fs from 'node:fs';
import path from 'node:path';

const MAX_FILES = 2000;
const MAX_FILE_SIZE = 512 * 1024;
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.koda', 'coverage', '.turbo']);
const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.rb', '.php']);

export interface BlastRadius {
  importers: string[];
  references: number;
  tests: string[];
}

function walk(dir: string, out: string[]): void {
  if (out.length >= MAX_FILES) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return;
    if (IGNORED_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, out);
    } else if (e.isFile() && CODE_EXTS.has(path.extname(e.name))) {
      out.push(full);
    }
  }
}

/**
 * Compute blast radius for a file path. The target is the file the agent
 * is about to modify.
 */
export function computeBlastRadius(workDir: string, targetPath: string): BlastRadius {
  const absTarget = path.isAbsolute(targetPath) ? targetPath : path.join(workDir, targetPath);
  const baseName = path.basename(absTarget, path.extname(absTarget));
  const relTarget = path.relative(workDir, absTarget).replace(/\\/g, '/');
  const parsed = path.parse(relTarget);
  const modulePathNoExt = path.join(parsed.dir, parsed.name).replace(/\\/g, '/');

  const files: string[] = [];
  walk(workDir, files);

  const importers = new Set<string>();
  const tests = new Set<string>();
  let references = 0;

  // Build regex patterns
  const importPattern = new RegExp(
    `(?:import\\s+.*?from\\s+|require\\s*\\(\\s*)['"]([^'"]*${escapeRegex(baseName)})['"]`,
    'g',
  );
  const symbolPattern = new RegExp(`\\b${escapeRegex(baseName)}\\b`, 'g');
  const isTestFile = (f: string) => /\.(test|spec)\.[jt]sx?$/i.test(f) || /__tests__/i.test(f);

  for (const file of files) {
    if (file === absTarget) continue;
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      continue;
    }
    if (size > MAX_FILE_SIZE) continue;
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    const rel = path.relative(workDir, file).replace(/\\/g, '/');

    // Check for import of the target
    let importMatch = false;
    importPattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = importPattern.exec(content)) !== null) {
      const importedPath = m[1]!;
      // Naive match: the imported path's basename equals our target basename
      const impBase = path.basename(importedPath, path.extname(importedPath));
      if (impBase === baseName) {
        importMatch = true;
        break;
      }
      // Or the resolved path matches our module path
      if (importedPath.includes(modulePathNoExt)) {
        importMatch = true;
        break;
      }
    }

    if (importMatch) {
      importers.add(rel);
      if (isTestFile(file)) tests.add(rel);
    }

    // Count symbol references (only if importing)
    if (importMatch) {
      symbolPattern.lastIndex = 0;
      let refCount = 0;
      while (symbolPattern.exec(content) !== null) refCount++;
      references += refCount;
    }
  }

  return {
    importers: Array.from(importers).slice(0, 20),
    references,
    tests: Array.from(tests).slice(0, 10),
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
