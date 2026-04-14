import { execa } from 'execa';
import { config } from '../config.js';

const DEFAULT_TIMEOUT = 60_000;
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
  try {
    const result = await execa(command, {
      shell: true,
      cwd: opts.cwd ?? config.WORK_DIR_ABS,
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT,
      reject: false,
      env: buildSubprocessEnv(),
      extendEnv: false,
      maxBuffer: MAX_OUTPUT * 2,
    });
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
  opts: { timeoutMs?: number } = {},
): Promise<{ exitCode: number; output: string }> {
  const r = await runShell(command, { cwd, timeoutMs: opts.timeoutMs });
  return {
    exitCode: r.exitCode,
    output: (r.stdout + (r.stderr ? `\n${r.stderr}` : '')).trim(),
  };
}
