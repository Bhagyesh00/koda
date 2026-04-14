import { TestRunArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

type Framework = 'vitest' | 'jest' | 'pytest' | 'cargo' | 'go';

async function detectFramework(cwd: string): Promise<Framework | null> {
  // Check for vitest
  const vitest = await runShell(
    'ls vitest.config.* vite.config.* 2>/dev/null',
    { cwd, timeoutMs: 5_000 },
  );
  if (vitest.exitCode === 0 && vitest.stdout.trim()) return 'vitest';

  // Check for jest
  const jest = await runShell(
    'ls jest.config.* 2>/dev/null',
    { cwd, timeoutMs: 5_000 },
  );
  if (jest.exitCode === 0 && jest.stdout.trim()) return 'jest';

  // Check for pytest
  const pytest = await runShell(
    'ls pytest.ini pyproject.toml setup.cfg 2>/dev/null',
    { cwd, timeoutMs: 5_000 },
  );
  if (pytest.exitCode === 0 && pytest.stdout.trim()) {
    if (pytest.stdout.includes('pytest.ini')) return 'pytest';
    const pyproject = await runShell(
      'grep -l "\\[tool.pytest\\]\\|\\[pytest\\]" pyproject.toml setup.cfg 2>/dev/null',
      { cwd, timeoutMs: 5_000 },
    );
    if (pyproject.exitCode === 0 && pyproject.stdout.trim()) return 'pytest';
  }

  // Check for cargo (Rust)
  const cargo = await runShell('ls Cargo.toml 2>/dev/null', { cwd, timeoutMs: 5_000 });
  if (cargo.exitCode === 0 && cargo.stdout.trim()) return 'cargo';

  // Check for go
  const goMod = await runShell('ls go.mod 2>/dev/null', { cwd, timeoutMs: 5_000 });
  if (goMod.exitCode === 0 && goMod.stdout.trim()) return 'go';

  return null;
}

export const testRunTool: Tool<typeof TestRunArgs._type> = {
  name: 'test_run',
  description:
    'Run tests (vitest, jest, pytest, cargo test, go test) and return results.',
  requiresApproval: false,
  schema: TestRunArgs,

  async run(args, ctx) {
    let framework = args.framework ?? 'auto';

    if (framework === 'auto') {
      const detected = await detectFramework(ctx.workDir);
      if (!detected) {
        return 'Could not auto-detect a test framework. No vitest.config.*, jest.config.*, pytest.ini, pyproject.toml, Cargo.toml, or go.mod found. Specify a framework explicitly.';
      }
      framework = detected;
    }

    const p = args.path ? `"${shellEscape(args.path)}"` : '';
    const f = args.filter ? shellEscape(args.filter) : '';

    let cmd: string;
    switch (framework) {
      case 'vitest':
        cmd = `npx vitest run ${p}${f ? ` --reporter verbose -t "${f}"` : ' --reporter verbose'}`;
        break;
      case 'jest':
        cmd = `npx jest ${p}${f ? ` -t "${f}"` : ''} --verbose`;
        break;
      case 'pytest':
        cmd = `python -m pytest ${p}${f ? ` -k "${f}"` : ''} -v`;
        break;
      case 'cargo':
        cmd = `cargo test ${f || ''} -- --nocapture`;
        break;
      case 'go':
        cmd = `go test ${p || './...'}${f ? ` -run "${f}"` : ''} -v`;
        break;
      default:
        return `Unknown test framework: ${framework}`;
    }

    const result = await runShell(cmd.trim(), { cwd: ctx.workDir, signal: ctx.signal });

    const parts: string[] = [];
    parts.push(`Framework: ${framework}`);
    parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    return parts.join('\n');
  },
};
