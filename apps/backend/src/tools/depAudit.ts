import { DepAuditArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'pip' | 'cargo';

/** Detect the package manager by looking for lock files / manifests. */
async function detectPackageManager(cwd: string, signal?: AbortSignal): Promise<PackageManager | null> {
  const checks: { file: string; pm: PackageManager }[] = [
    { file: 'pnpm-lock.yaml', pm: 'pnpm' },
    { file: 'package-lock.json', pm: 'npm' },
    { file: 'yarn.lock', pm: 'yarn' },
    { file: 'requirements.txt', pm: 'pip' },
    { file: 'Cargo.toml', pm: 'cargo' },
  ];

  for (const { file, pm } of checks) {
    // Use a simple existence check via shell
    const result = await runShell(
      process.platform === 'win32'
        ? `if exist "${file}" (echo found) else (echo notfound)`
        : `[ -f "${file}" ] && echo found || echo notfound`,
      { cwd, signal },
    );
    if (result.stdout.trim() === 'found') return pm;
  }

  return null;
}

export const depAuditTool: Tool<typeof DepAuditArgs._type> = {
  name: 'dep_audit',
  description: 'Audit project dependencies for known security vulnerabilities.',
  requiresApproval: false,
  schema: DepAuditArgs,

  async run(args, ctx) {
    let pm = args.packageManager ?? null;

    // Auto-detect if not specified
    if (!pm) {
      pm = await detectPackageManager(ctx.workDir, ctx.signal);
      if (!pm) {
        return 'Could not detect package manager. No lock file or manifest found (package-lock.json, pnpm-lock.yaml, yarn.lock, requirements.txt, Cargo.toml). Specify packageManager explicitly.';
      }
    }

    let cmd: string;
    switch (pm) {
      case 'npm':
        cmd = 'npm audit --json';
        break;
      case 'pnpm':
        cmd = 'pnpm audit --json';
        break;
      case 'yarn':
        cmd = 'yarn audit --json';
        break;
      case 'pip':
        cmd = 'pip-audit --format json';
        break;
      case 'cargo':
        cmd = 'cargo audit --json';
        break;
    }

    const result = await runShell(cmd, { cwd: ctx.workDir, signal: ctx.signal });

    const parts: string[] = [];
    parts.push(`## Dependency Audit (${pm})\n`);

    // Try to parse and format JSON output
    const rawOutput = result.stdout || result.stderr;
    try {
      const parsed = JSON.parse(rawOutput);
      parts.push(JSON.stringify(parsed, null, 2));
    } catch {
      // If JSON parsing fails, return raw output
      if (result.stdout) parts.push(result.stdout);
      if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    }

    parts.push(`\nexit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);

    return parts.join('\n');
  },
};
