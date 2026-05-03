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

  // Realpath check to defeat symlink escapes. Try the joined path first; if it
  // doesn't exist, walk up to the nearest existing ancestor and verify *that*.
  // Avoids the prior TOCTOU window between existsSync() and realpathSync().
  try {
    const realRoot = fs.realpathSync(root);
    let probe = joined;
    let realProbe: string | null = null;
    // Walk up from the requested path until we hit something that exists,
    // then realpath that ancestor. This catches both existing-file symlink
    // escapes AND new-file paths that include a symlinked parent dir.
    while (probe.length >= root.length) {
      try {
        realProbe = fs.realpathSync(probe);
        break;
      } catch {
        const parent = path.dirname(probe);
        if (parent === probe) break;
        probe = parent;
      }
    }
    if (realProbe) {
      const realRel = path.relative(realRoot, realProbe);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        throw new SandboxError(`Symlink escapes work dir: ${userPath}`);
      }
    }
  } catch (err) {
    if (err instanceof SandboxError) throw err;
    // realpath failures on the root itself are non-fatal — lexical check stands.
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
