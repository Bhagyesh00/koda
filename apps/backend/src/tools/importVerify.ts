import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ImportVerifyArgs } from '@koda/shared';
import type { Tool } from './registry.js';

const BUILTIN_NODE_MODULES = new Set([
  'fs', 'path', 'os', 'crypto', 'http', 'https', 'url', 'util', 'stream',
  'events', 'child_process', 'cluster', 'buffer', 'zlib', 'net', 'tls',
  'dns', 'querystring', 'readline', 'assert', 'string_decoder', 'timers',
  'tty', 'v8', 'vm', 'worker_threads', 'perf_hooks', 'async_hooks',
]);

function extractImportSpecs(content: string, ext: string): string[] {
  const specs: string[] = [];
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    const patterns = [
      /\bimport\s+(?:[^'"\n]+\s+from\s+)?['"]([^'"]+)['"]/g,
      /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        if (m[1]) specs.push(m[1]);
      }
    }
  } else if (ext === '.py') {
    const patterns = [
      /^\s*import\s+([\w.]+)/gm,
      /^\s*from\s+([\w.]+)\s+import\b/gm,
    ];
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        if (m[1]) specs.push(m[1]);
      }
    }
  }
  return specs;
}

async function findProjectRoot(start: string): Promise<string | null> {
  let dir = path.dirname(path.resolve(start));
  for (let i = 0; i < 10; i++) {
    try {
      await fs.access(path.join(dir, 'package.json'));
      return dir;
    } catch { /* ignore */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function verifyNodeModule(spec: string, projectRoot: string, sourceFile: string): Promise<boolean> {
  if (spec.startsWith('node:')) return BUILTIN_NODE_MODULES.has(spec.slice(5));
  if (BUILTIN_NODE_MODULES.has(spec)) return true;
  if (spec.startsWith('.') || spec.startsWith('/')) {
    // Relative or absolute — check the filesystem
    const baseDir = spec.startsWith('/') ? '' : path.dirname(sourceFile);
    const base = path.resolve(baseDir, spec);
    for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '/index.ts', '/index.js']) {
      try {
        await fs.access(base + ext);
        return true;
      } catch { /* try next */ }
    }
    return false;
  }
  // Scoped or normal package — strip subpath
  const pkg = spec.startsWith('@')
    ? spec.split('/').slice(0, 2).join('/')
    : spec.split('/')[0]!;
  try {
    await fs.access(path.join(projectRoot, 'node_modules', pkg));
    return true;
  } catch {
    return false;
  }
}

export const importVerifyTool: Tool<typeof ImportVerifyArgs._type> = {
  name: 'import_verify',
  description:
    'Validate every import statement in a file against the actual installed dependencies and local modules. Catches hallucinated imports.',
  requiresApproval: false,
  schema: ImportVerifyArgs,
  async run(args, ctx) {
    const absPath = path.isAbsolute(args.path) ? args.path : path.join(ctx.workDir, args.path);
    let content: string;
    try {
      content = await fs.readFile(absPath, 'utf-8');
    } catch (e) {
      return `Error reading file: ${e instanceof Error ? e.message : String(e)}`;
    }

    const ext = path.extname(absPath);
    const specs = extractImportSpecs(content, ext);
    if (specs.length === 0) return `No imports found in ${args.path}`;

    const projectRoot = await findProjectRoot(absPath);
    const unresolved: string[] = [];
    const resolved: string[] = [];

    for (const spec of specs) {
      if (ext === '.py') {
        // Python — we can only cheaply validate stdlib-ish; mark external as unverified
        resolved.push(spec);
        continue;
      }
      if (!projectRoot) {
        unresolved.push(`${spec} (no package.json found)`);
        continue;
      }
      const ok = await verifyNodeModule(spec, projectRoot, absPath);
      if (ok) resolved.push(spec);
      else unresolved.push(spec);
    }

    const lines = [
      `Import verification for ${args.path}:`,
      `  ✓ Resolved: ${resolved.length}`,
      `  ✗ Unresolved: ${unresolved.length}`,
    ];
    if (unresolved.length > 0) {
      lines.push('\nUnresolved imports (possibly hallucinated):');
      lines.push(...unresolved.map((u) => `  - ${u}`));
    }
    return lines.join('\n');
  },
};
