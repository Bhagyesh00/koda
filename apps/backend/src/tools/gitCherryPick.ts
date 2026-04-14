import { GitCherryPickArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const gitCherryPickTool: Tool<typeof GitCherryPickArgs._type> = {
  name: 'git_cherry_pick',
  description: 'Cherry-pick a commit onto the current branch. Requires approval.',
  requiresApproval: true,
  schema: GitCherryPickArgs,

  async run(args, ctx) {
    const check = await runShell('git rev-parse --is-inside-work-tree', {
      cwd: ctx.workDir,
      timeoutMs: 5_000,
    });
    if (check.exitCode !== 0) {
      return 'Not a git repository (or no git installed).';
    }

    const noCommit = args.noCommit ? '--no-commit ' : '';
    const commit = shellEscape(args.commit);

    const cmd = `git cherry-pick ${noCommit}"${commit}"`;

    const result = await runShell(cmd.trim(), { cwd: ctx.workDir, signal: ctx.signal });

    const parts: string[] = [];
    parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    return parts.join('\n');
  },
};
