import { LintArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

type Linter = 'eslint' | 'ruff' | 'clippy' | 'golangci-lint';

async function detectLinter(cwd: string): Promise<Linter | null> {
  // Check for eslint
  const eslint = await runShell(
    'ls .eslintrc* .eslintrc.js .eslintrc.cjs .eslintrc.json .eslintrc.yml eslint.config.* 2>/dev/null',
    { cwd, timeoutMs: 5_000 },
  );
  if (eslint.exitCode === 0 && eslint.stdout.trim()) return 'eslint';

  // Check for ruff (Python)
  const ruff = await runShell(
    'ls ruff.toml pyproject.toml 2>/dev/null',
    { cwd, timeoutMs: 5_000 },
  );
  if (ruff.exitCode === 0 && ruff.stdout.trim()) {
    // Confirm ruff is configured in pyproject.toml or ruff.toml exists
    if (ruff.stdout.includes('ruff.toml')) return 'ruff';
    const pyproject = await runShell('grep -l "\\[tool.ruff\\]" pyproject.toml 2>/dev/null', { cwd, timeoutMs: 5_000 });
    if (pyproject.exitCode === 0 && pyproject.stdout.trim()) return 'ruff';
  }

  // Check for Cargo (Rust clippy)
  const cargo = await runShell('ls Cargo.toml 2>/dev/null', { cwd, timeoutMs: 5_000 });
  if (cargo.exitCode === 0 && cargo.stdout.trim()) return 'clippy';

  // Check for golangci-lint
  const goLint = await runShell('ls .golangci.yml .golangci.yaml 2>/dev/null', { cwd, timeoutMs: 5_000 });
  if (goLint.exitCode === 0 && goLint.stdout.trim()) return 'golangci-lint';

  return null;
}

export const lintTool: Tool<typeof LintArgs._type> = {
  name: 'lint',
  description:
    'Run a linter (eslint, ruff, clippy, golangci-lint) and return issues found.',
  requiresApproval: false,
  schema: LintArgs,

  async run(args, ctx) {
    const p = shellEscape(args.path ?? '.');
    const fix = args.fix ?? false;
    let tool = args.tool ?? 'auto';

    if (tool === 'auto') {
      const detected = await detectLinter(ctx.workDir);
      if (!detected) {
        return 'Could not auto-detect a linter. No .eslintrc*, ruff.toml, pyproject.toml, Cargo.toml, or .golangci.yml found. Specify a tool explicitly.';
      }
      tool = detected;
    }

    let cmd: string;
    switch (tool) {
      case 'eslint':
        cmd = `npx eslint "${p}" --format stylish${fix ? ' --fix' : ''}`;
        break;
      case 'ruff':
        cmd = `ruff check "${p}"${fix ? ' --fix' : ''}`;
        break;
      case 'clippy':
        cmd = `cargo clippy${fix ? ' --fix' : ''} -- -W clippy::all`;
        break;
      case 'golangci-lint':
        cmd = `golangci-lint run "${p}"`;
        break;
      default:
        return `Unknown linter: ${tool}`;
    }

    const result = await runShell(cmd, { cwd: ctx.workDir, signal: ctx.signal });

    const parts: string[] = [];
    parts.push(`Linter: ${tool}`);
    parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    return parts.join('\n');
  },
};
