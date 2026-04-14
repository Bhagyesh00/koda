import { GitLogArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

export const gitLogTool: Tool<GitLogArgs> = {
  name: 'git_log',
  description: 'Show recent git commit history as a one-line graph.',
  requiresApproval: false,
  schema: GitLogArgs,

  async run(args, ctx) {
    const check = await runShell('git rev-parse --is-inside-work-tree', { cwd: ctx.workDir, timeoutMs: 5_000 });
    if (check.exitCode !== 0) return 'Not a git repository.';

    const n = args.maxCommits ?? 20;
    const pathArg = args.path ? `-- "${args.path}"` : '';
    const cmd = `git log --oneline --graph --decorate -${n} ${pathArg}`.trim();

    const result = await runShell(cmd, { cwd: ctx.workDir, timeoutMs: 15_000 });
    const output = result.stdout.trim();
    return output || 'No commits found.';
  },
};
