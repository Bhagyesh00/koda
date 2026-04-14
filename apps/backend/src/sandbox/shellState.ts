import path from 'node:path';

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
 * Parse `cd` calls from a shell command string and resolve the final working
 * directory against `currentCwd`.
 *
 * Handles simple cases:
 *   cd src                → resolve("src", currentCwd)
 *   cd ..                 → resolve("..", currentCwd)
 *   cd /absolute/path     → "/absolute/path"
 *   cd ~ or cd            → HOME directory
 *   cd foo && cd bar      → resolve("bar", resolve("foo", currentCwd))
 *
 * Does NOT handle subshell expansion ($(...)), variables, or pushd/popd.
 * Those edge cases are rare enough that falling back to the previous CWD is
 * acceptable — the next explicit `cd` will correct it.
 */
export function trackCd(command: string, currentCwd: string): string {
  const re = /(?:^|[;&|])\s*cd(?:\s+([^\s;&|]+))?/g;
  let cwd = currentCwd;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    const target = m[1]?.trim();
    if (!target || target === '-') {
      // bare `cd` or `cd -` — go home (cd - is "previous dir" which we can't track)
      cwd = process.env.HOME ?? process.env.USERPROFILE ?? cwd;
    } else if (target === '~' || target.startsWith('~/')) {
      const home = process.env.HOME ?? process.env.USERPROFILE ?? cwd;
      cwd = target === '~' ? home : path.join(home, target.slice(2));
    } else {
      cwd = path.resolve(cwd, target);
    }
  }
  return cwd;
}
