import { GitCommitArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

export const gitCommitTool: Tool<GitCommitArgs> = {
  name: 'git_commit',
  description: 'Stage files and create a git commit. Requires user approval.',
  requiresApproval: true,
  schema: GitCommitArgs,

  async run(args, ctx) {
    const check = await runShell('git rev-parse --is-inside-work-tree', { cwd: ctx.workDir, timeoutMs: 5_000 });
    if (check.exitCode !== 0) return 'Not a git repository (or no git installed).';

    const quotedMessage = JSON.stringify(args.message);

    if (args.files && args.files.length > 0) {
      const fileList = args.files.map((f) => `"${f}"`).join(' ');
      const addResult = await runShell(`git add -- ${fileList}`, {
        cwd: ctx.workDir,
        signal: ctx.signal,
        timeoutMs: 15_000,
      });
      if (addResult.exitCode !== 0) {
        return (addResult.stdout + (addResult.stderr ? `\n${addResult.stderr}` : '')).trim();
      }
    }

    const commitCmd = args.files && args.files.length > 0
      ? `git commit -m ${quotedMessage}`
      : `git commit -am ${quotedMessage}`;

    const result = await runShell(commitCmd, {
      cwd: ctx.workDir,
      signal: ctx.signal,
      timeoutMs: 30_000,
    });

    return (result.stdout + (result.stderr ? `\n${result.stderr}` : '')).trim();
  },
};
