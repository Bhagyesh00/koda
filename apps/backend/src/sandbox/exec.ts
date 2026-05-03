import { execa } from 'execa';
import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { logger } from '../logger.js';

const DEFAULT_TIMEOUT = 300_000; // 5 minutes — large file writes can easily exceed 60 s
const MAX_OUTPUT = 100_000;

export interface ExecResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunShellOptions {
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Kill a process *and its entire subtree*. execa's cancelSignal/timeout only
 * kill the parent shell; on Windows that leaves the actual command running as
 * an orphan (npm install, pytest, dev servers, etc.). taskkill /T walks the
 * tree; on POSIX we kill the process group.
 */
function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    const tk = spawn('taskkill', ['/T', '/F', '/PID', String(pid)], {
      stdio: 'ignore',
      windowsHide: true,
    });
    tk.on('error', (err) => logger.debug({ err, pid }, 'taskkill failed'));
    return;
  }
  try {
    // Negative PID targets the process group (execa with shell:true creates one).
    process.kill(-pid, 'SIGKILL');
  } catch {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

/**
 * Build a minimal-but-functional environment for subprocesses.
 * We avoid leaking all server env vars to user commands while still providing
 * the OS-level vars every shell command needs (PATH, HOME, TEMP, etc.).
 */
function buildSubprocessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? process.env.Path ?? '',
    HOME: process.env.HOME ?? process.env.USERPROFILE ?? '',
  };
  // On Windows, SYSTEMROOT, COMSPEC, TEMP etc. are required by most programs.
  if (process.platform === 'win32') {
    for (const k of ['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP',
      'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)']) {
      const v = process.env[k];
      if (v !== undefined) env[k] = v;
    }
  }
  return env;
}

export async function runShell(
  command: string,
  opts: RunShellOptions = {},
): Promise<ExecResult> {
  const subprocess = execa(command, {
    shell: true,
    cwd: opts.cwd ?? config.WORK_DIR_ABS,
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT,
    reject: false,
    env: buildSubprocessEnv(),
    extendEnv: false,
    maxBuffer: MAX_OUTPUT * 2,
    cancelSignal: opts.signal,
    // Detach + own process group on POSIX so killTree can SIGKILL the whole group.
    detached: process.platform !== 'win32',
  });

  // Kill the whole subprocess tree on abort (execa's cancelSignal only kills the
  // parent shell). Without this, on Windows a long-running child (npm install,
  // pytest, dev servers) survives Ctrl+C.
  let cleanup: (() => void) | null = null;
  if (opts.signal) {
    const onAbort = () => killTree(subprocess.pid);
    if (opts.signal.aborted) onAbort();
    else {
      opts.signal.addEventListener('abort', onAbort, { once: true });
      cleanup = () => opts.signal!.removeEventListener('abort', onAbort);
    }
  }

  try {
    const result = await subprocess;
    // execa's internal timeout fires before our abort path — also reap children.
    if (result.timedOut) killTree(subprocess.pid);
    return {
      ok: result.exitCode === 0,
      exitCode: result.exitCode ?? -1,
      stdout: truncate(result.stdout ?? ''),
      stderr: truncate(result.stderr ?? ''),
      timedOut: result.timedOut ?? false,
    };
  } catch (err) {
    return {
      ok: false,
      exitCode: -1,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
      timedOut: false,
    };
  } finally {
    cleanup?.();
  }
}

function truncate(s: string): string {
  if (s.length <= MAX_OUTPUT) return s;
  return s.slice(0, MAX_OUTPUT) + `\n... [truncated ${s.length - MAX_OUTPUT} bytes]`;
}

/** Convenience wrapper for hypothesis verification and snapshot commands. */
export async function runCommand(
  command: string,
  cwd: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ exitCode: number; output: string }> {
  const r = await runShell(command, { cwd, timeoutMs: opts.timeoutMs, signal: opts.signal });
  return {
    exitCode: r.exitCode,
    output: (r.stdout + (r.stderr ? `\n${r.stderr}` : '')).trim(),
  };
}

// ── Phase 3 — Pre-Flight Simulation ────────────────────────────────────────────

/**
 * Cached Docker availability — probed once on first preflight call. Null until
 * the probe completes; thereafter true/false. We don't probe at startup so a
 * slow or absent Docker daemon never delays server boot.
 */
let dockerAvailable: boolean | null = null;
let dockerProbe: Promise<boolean> | null = null;

async function probeDocker(): Promise<boolean> {
  if (dockerAvailable !== null) return dockerAvailable;
  if (dockerProbe) return dockerProbe;
  dockerProbe = (async () => {
    try {
      const r = await execa('docker', ['version', '--format', '{{.Server.Version}}'], {
        timeout: 3_000,
        reject: false,
        windowsHide: true,
      });
      const ok = r.exitCode === 0 && !!(r.stdout ?? '').trim();
      dockerAvailable = ok;
      return ok;
    } catch {
      dockerAvailable = false;
      return false;
    } finally {
      dockerProbe = null;
    }
  })();
  return dockerProbe;
}

/** Reset the cached probe (for tests). */
export function _resetDockerProbeForTests(): void {
  dockerAvailable = null;
  dockerProbe = null;
}

/** Force the cached Docker availability — for deterministic tests only. */
export function _setDockerAvailableForTests(value: boolean | null): void {
  dockerAvailable = value;
  dockerProbe = null;
}

export interface PreFlightResult extends ExecResult {
  /** Whether the command actually ran inside a container. False = host fallback. */
  ranInContainer: boolean;
  /** When ranInContainer is false, why we fell back. */
  fallbackReason?: string;
}

export interface RunPreFlightOptions extends RunShellOptions {
  /** Override the image used for this run. Defaults to config.PREFLIGHT_IMAGE. */
  image?: string;
  /**
   * When true, fail instead of falling back to the host shell. Use this for
   * truly untrusted commands where host execution would be unsafe.
   */
  strict?: boolean;
}

/**
 * Run a command in an isolated Docker container when available, falling back
 * to the host shell otherwise (unless `strict` or `PREFLIGHT_MODE=docker`).
 *
 * The container mounts the workspace read-write at /work and disables the
 * network — appropriate for proof-style verification runs (typecheck, tests,
 * lint). For host fallback we delegate to runShell so behavior is identical.
 */
export async function runShellPreFlight(
  command: string,
  opts: RunPreFlightOptions = {},
): Promise<PreFlightResult> {
  const mode = config.PREFLIGHT_MODE;
  const wantHost = mode === 'host';
  const requireDocker = mode === 'docker' || opts.strict === true;

  if (wantHost && !requireDocker) {
    const r = await runShell(command, opts);
    return { ...r, ranInContainer: false, fallbackReason: 'PREFLIGHT_MODE=host' };
  }

  const available = await probeDocker();
  if (!available) {
    if (requireDocker) {
      return {
        ok: false,
        exitCode: -1,
        stdout: '',
        stderr: 'docker is required (PREFLIGHT_MODE=docker or strict=true) but not available',
        timedOut: false,
        ranInContainer: false,
        fallbackReason: 'docker_unavailable',
      };
    }
    const r = await runShell(command, opts);
    return { ...r, ranInContainer: false, fallbackReason: 'docker_unavailable' };
  }

  const cwd = opts.cwd ?? config.WORK_DIR_ABS;
  const image = opts.image ?? config.PREFLIGHT_IMAGE;
  const timeoutMs = opts.timeoutMs ?? config.PREFLIGHT_TIMEOUT_MS;

  // We pass the user's command verbatim to `sh -c` *inside* the container —
  // execa receives it as a separate argv element so there's no shell injection
  // on the host. The container's sh interprets it, same as a bash tool call.
  const dockerArgs = [
    'run',
    '--rm',
    '--network=none',
    '--mount',
    `type=bind,src=${cwd},dst=/work`,
    '-w',
    '/work',
    image,
    'sh',
    '-c',
    command,
  ];

  try {
    const r = await execa('docker', dockerArgs, {
      timeout: timeoutMs,
      reject: false,
      windowsHide: true,
      maxBuffer: MAX_OUTPUT * 2,
      cancelSignal: opts.signal,
    });
    return {
      ok: r.exitCode === 0,
      exitCode: r.exitCode ?? -1,
      stdout: truncate(r.stdout ?? ''),
      stderr: truncate(r.stderr ?? ''),
      timedOut: r.timedOut ?? false,
      ranInContainer: true,
    };
  } catch (err) {
    return {
      ok: false,
      exitCode: -1,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
      timedOut: false,
      ranInContainer: true,
    };
  }
}
