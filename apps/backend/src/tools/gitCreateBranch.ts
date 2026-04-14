import { GitCreateBranchArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

export const gitCreateBranchTool: Tool<GitCreateBranchArgs> = {
  name: 'git_create_branch',
  description: 'Create a new git branch from the current HEAD or a specified ref.',
  requiresApproval: false,
  schema: GitCreateBranchArgs,

  async run(args, ctx) {
    const check = await runShell('git rev-parse --is-inside-work-tree', { cwd: ctx.workDir, timeoutMs: 5_000 });
    if (check.exitCode !== 0) return 'Not a git repository (or no git installed).';

    const cmd = args.from
      ? `git checkout -b "${args.name}" "${args.from}"`
      : `git checkout -b "${args.name}"`;

    const result = await runShell(cmd, {
      cwd: ctx.workDir,
      signal: ctx.signal,
      timeoutMs: 15_000,
    });

    return (result.stdout + (result.stderr ? `\n${result.stderr}` : '')).trim();
  },
};
