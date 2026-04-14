import { CoverageArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

type Framework = 'vitest' | 'jest' | 'pytest' | 'cargo' | 'go';

async function detectFramework(cwd: string): Promise<Framework | null> {
  const vitest = await runShell('ls vitest.config.* vite.config.* 2>/dev/null', { cwd, timeoutMs: 5_000 });
  if (vitest.exitCode === 0 && vitest.stdout.trim()) return 'vitest';

  const jest = await runShell('ls jest.config.* 2>/dev/null', { cwd, timeoutMs: 5_000 });
  if (jest.exitCode === 0 && jest.stdout.trim()) return 'jest';

  const pytest = await runShell('ls pytest.ini pyproject.toml setup.cfg 2>/dev/null', { cwd, timeoutMs: 5_000 });
  if (pytest.exitCode === 0 && pytest.stdout.trim()) {
    if (pytest.stdout.includes('pytest.ini')) return 'pytest';
    const pyproject = await runShell(
      'grep -l "\\[tool.pytest\\]\\|\\[pytest\\]" pyproject.toml setup.cfg 2>/dev/null',
      { cwd, timeoutMs: 5_000 },
    );
    if (pyproject.exitCode === 0 && pyproject.stdout.trim()) return 'pytest';
  }

  const cargo = await runShell('ls Cargo.toml 2>/dev/null', { cwd, timeoutMs: 5_000 });
  if (cargo.exitCode === 0 && cargo.stdout.trim()) return 'cargo';

  const goMod = await runShell('ls go.mod 2>/dev/null', { cwd, timeoutMs: 5_000 });
  if (goMod.exitCode === 0 && goMod.stdout.trim()) return 'go';

  return null;
}

export const coverageTool: Tool<typeof CoverageArgs._type> = {
  name: 'coverage',
  description:
    'Generate test coverage report — total coverage %, uncovered files, uncovered lines.',
  requiresApproval: false,
  schema: CoverageArgs,

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

    let cmd: string;
    switch (framework) {
      case 'vitest':
        cmd = `npx vitest run --coverage ${p}`;
        break;
      case 'jest':
        cmd = `npx jest --coverage ${p}`;
        break;
      case 'pytest':
        cmd = `python -m pytest --cov ${p || '.'} --cov-report=term-missing`;
        break;
      case 'cargo':
        cmd = 'cargo tarpaulin --out Stdout';
        break;
      case 'go':
        cmd = `go test ${p || './...'} -coverprofile=coverage.out && go tool cover -func=coverage.out`;
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
