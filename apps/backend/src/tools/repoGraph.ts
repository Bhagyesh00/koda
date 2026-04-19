import { promises as fs } from 'node:fs';
import path from 'node:path';
import { RepoGraphArgs } from '@koda/shared';
import type { Tool } from './registry.js';

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', '__pycache__', 'target']);
const MAX_FILES_PER_REPO = 500;

interface FileInfo {
  repoRoot: string;
  relPath: string;
  imports: string[];
}

async function scanRepo(root: string): Promise<FileInfo[]> {
  const results: FileInfo[] = [];
  async function walk(dir: string): Promise<void> {
    if (results.length >= MAX_FILES_PER_REPO) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch { return; }
    for (const e of entries) {
      if (results.length >= MAX_FILES_PER_REPO) break;
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && CODE_EXTENSIONS.has(path.extname(e.name))) {
        try {
          const content = await fs.readFile(full, 'utf-8');
          const imports = extractImports(content);
          results.push({ repoRoot: root, relPath: path.relative(root, full), imports });
        } catch { /* skip */ }
      }
    }
  }
  await walk(root);
  return results;
}

function extractImports(content: string): string[] {
  const imports: string[] = [];
  const patterns = [
    /\bimport\s+(?:[^'"\n]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bfrom\s+([\w.]+)\s+import\b/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m[1]) imports.push(m[1]);
    }
  }
  return imports;
}

export const repoGraphTool: Tool<typeof RepoGraphArgs._type> = {
  name: 'repo_graph',
  description:
    'Index multiple repositories and build a cross-repo dependency graph. Useful for understanding how changes in one repo affect callers in others.',
  requiresApproval: false,
  schema: RepoGraphArgs,
  async run(args, _ctx) {
    const results: FileInfo[] = [];
    for (const root of args.roots) {
      try {
        await fs.access(root);
        const scan = await scanRepo(root);
        results.push(...scan);
      } catch {
        return `Error: repo root not accessible: ${root}`;
      }
    }

    if (args.symbol) {
      const matches = results.filter((f) =>
        f.imports.some((imp) => imp.includes(args.symbol!)),
      );
      if (matches.length === 0) return `No references to "${args.symbol}" found across ${args.roots.length} repos.`;
      const grouped = new Map<string, string[]>();
      for (const m of matches) {
        const arr = grouped.get(m.repoRoot) ?? [];
        arr.push(m.relPath);
        grouped.set(m.repoRoot, arr);
      }
      return Array.from(grouped.entries())
        .map(([repo, files]) => `${repo}:\n  ${files.join('\n  ')}`)
        .join('\n\n');
    }

    // Summary: files per repo + cross-repo imports
    const summary: string[] = [`Indexed ${results.length} files across ${args.roots.length} repos:`];
    for (const root of args.roots) {
      const files = results.filter((r) => r.repoRoot === root);
      const uniqueImports = new Set(files.flatMap((f) => f.imports));
      summary.push(`  ${root}: ${files.length} files, ${uniqueImports.size} unique imports`);
    }

    const crossRepo = new Map<string, string[]>();
    for (const f of results) {
      for (const imp of f.imports) {
        if (imp.startsWith('.') || imp.startsWith('/')) continue;
        const otherRoot = args.roots.find((r) => r !== f.repoRoot && imp.includes(path.basename(r)));
        if (otherRoot) {
          const key = `${f.repoRoot} -> ${otherRoot}`;
          const arr = crossRepo.get(key) ?? [];
          arr.push(`${f.relPath} imports ${imp}`);
          crossRepo.set(key, arr);
        }
      }
    }

    if (crossRepo.size > 0) {
      summary.push('\nCross-repo dependencies:');
      for (const [key, uses] of crossRepo) {
        summary.push(`  ${key}: ${uses.length} references`);
      }
    }

    return summary.join('\n');
  },
};
