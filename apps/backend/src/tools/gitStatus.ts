import { GitStatusArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

export const gitStatusTool: Tool<GitStatusArgs> = {
  name: 'git_status',
  description: 'Show working tree status — staged, unstaged, and untracked files.',
  requiresApproval: false,
  schema: GitStatusArgs,

  async run(args, ctx) {
    // Verify this is a git repo first
    const check = await runShell('git rev-parse --is-inside-work-tree', { cwd: ctx.workDir, timeoutMs: 5_000 });
    if (check.exitCode !== 0) {
      return 'Not a git repository (or no git installed).';
    }

    const flags = args.short ? '--short' : '';
    const result = await runShell(`git status ${flags}`.trim(), { cwd: ctx.workDir, timeoutMs: 10_000 });

    const output = (result.stdout + (result.stderr ? `\n${result.stderr}` : '')).trim();
    return output || 'Nothing to report — working tree is clean.';
  },
};
