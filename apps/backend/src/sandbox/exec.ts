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
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? process.env.USERPROFILE ?? '',
      },
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
