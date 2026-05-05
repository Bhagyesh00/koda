import path from 'node:path';
import fs from 'node:fs';

/**
 * Ephemeral per-session shell working directory.
 *
 * NOT persisted to disk — shell state resets when the server restarts, which
 * mirrors the behaviour of a real terminal session. This is intentional: a
 * persisted shell CWD can point to a directory that no longer exists after a
 * workspace change, causing confusing errors.
 */
const shellCwds = new Map<string, string>();

/** Return the current shell CWD for a session, defaulting to `fallback`. */
export function getShellCwd(sessionId: string, fallback: string): string {
  return shellCwds.get(sessionId) ?? fallback;
}

/** Persist a new shell CWD for a session. */
export function setShellCwd(sessionId: string, cwd: string): void {
  shellCwds.set(sessionId, cwd);
}

/** Clear shell state when a session is deleted. */
export function clearShellCwd(sessionId: string): void {
  shellCwds.delete(sessionId);
}

/**
 * Result of resolving `cd` commands inside a shell invocation.
 *
 * `cwd` is the post-resolution working directory — equal to `currentCwd`
 * when the command had no `cd`, or when every `cd` target was rejected.
 * `warnings` lists each rejected target with a human-readable reason so the
 * caller can surface them to the model (and stop it from looping on a path
 * that doesn't exist).
 */
export interface TrackCdResult {
  cwd: string;
  warnings: string[];
}

/**
 * Parse `cd` calls from a shell command string and resolve the final working
 * directory against `currentCwd`.
 *
 * Handles simple cases:
 *   cd src                → resolve("src", currentCwd) (verified to exist)
 *   cd ..                 → resolve("..", currentCwd)
 *   cd /absolute/path     → "/absolute/path"
 *   cd ~ or cd            → HOME directory
 *   cd foo && cd bar      → resolve("bar", resolve("foo", currentCwd))
 *
 * Each resolved target is verified with `fs.existsSync` before being adopted
 * as the new cwd. If a target doesn't exist we keep the previous cwd and
 * record a warning — this prevents the "compounding-cd" failure mode where a
 * model emits `cd ecommerce-site` repeatedly while already inside it, building
 * `.../ecommerce-site/ecommerce-site/.../ecommerce-site` until every command
 * fails.
 *
 * Does NOT handle subshell expansion ($(...)), variables, or pushd/popd.
 * Those edge cases are rare enough that falling back to the previous CWD is
 * acceptable — the next explicit `cd` will correct it.
 */
export function trackCd(command: string, currentCwd: string): TrackCdResult {
  const re = /(?:^|[;&|])\s*cd(?:\s+([^\s;&|]+))?/g;
  let cwd = currentCwd;
  const warnings: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    const target = m[1]?.trim();
    let candidate: string;
    if (!target || target === '-') {
      // bare `cd` or `cd -` — go home (cd - is "previous dir" which we can't track)
      candidate = process.env.HOME ?? process.env.USERPROFILE ?? cwd;
    } else if (target === '~' || target.startsWith('~/')) {
      const home = process.env.HOME ?? process.env.USERPROFILE ?? cwd;
      candidate = target === '~' ? home : path.join(home, target.slice(2));
    } else {
      candidate = path.resolve(cwd, target);
    }
    // Verify the resolved target exists and is a directory. If not, keep the
    // current cwd and warn — refusing to compound a bad path.
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isDirectory()) {
        warnings.push(`cd: '${target ?? candidate}' is not a directory; staying at ${cwd}`);
        continue;
      }
    } catch {
      warnings.push(`cd: '${target ?? candidate}' does not exist (resolved to ${candidate}); staying at ${cwd}`);
      continue;
    }
    cwd = candidate;
  }
  return { cwd, warnings };
}
