import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { SandboxError } from '../errors.js';

/**
 * Resolve a user-supplied path against an explicit sandbox root and verify it
 * stays inside (defeating both lexical traversal and symlink escapes).
 *
 * Pass the per-session cwd as `root` so each session can be sandboxed to its
 * own working directory; falls back to the server-wide WORK_DIR otherwise.
 */
export function resolveInside(root: string, userPath: string): string {
  const joined = path.resolve(root, userPath);

  // Lexical containment check first
  const rel = path.relative(root, joined);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new SandboxError(`Path escapes work dir: ${userPath}`);
  }

  // Realpath check (only if exists) to defeat symlink escapes
  try {
    if (fs.existsSync(joined)) {
      const real = fs.realpathSync(joined);
      const realRoot = fs.realpathSync(root);
      const realRel = path.relative(realRoot, real);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        throw new SandboxError(`Symlink escapes work dir: ${userPath}`);
      }
    }
  } catch (err) {
    if (err instanceof SandboxError) throw err;
    // ignore other realpath errors (file may not exist yet)
  }

  return joined;
}

/**
 * Backwards-compatible helper that resolves against the global WORK_DIR.
 * Prefer `resolveInside(ctx.workDir, userPath)` from inside tools so each
 * session honours its own cwd.
 */
export function resolveInsideWorkDir(userPath: string): string {
  return resolveInside(config.WORK_DIR_ABS, userPath);
}
