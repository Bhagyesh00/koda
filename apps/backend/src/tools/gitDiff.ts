import { GitDiffArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

const MAX_DIFF_CHARS = 12_000;

export const gitDiffTool: Tool<GitDiffArgs> = {
  name: 'git_diff',
  description: 'Show changes between working tree and a git ref.',
  requiresApproval: false,
  schema: GitDiffArgs,

  async run(args, ctx) {
    const check = await runShell('git rev-parse --is-inside-work-tree', { cwd: ctx.workDir, timeoutMs: 5_000 });
    if (check.exitCode !== 0) return 'Not a git repository.';

    const ref = args.ref ?? 'HEAD';
    const stat = args.statOnly ? '--stat' : '';
    const pathArg = args.path ? `-- "${args.path}"` : '';
    const cmd = `git diff ${ref} ${stat} ${pathArg}`.trim().replace(/\s+/g, ' ');

    const result = await runShell(cmd, { cwd: ctx.workDir, timeoutMs: 15_000 });
    let output = (result.stdout + (result.stderr ? `\n${result.stderr}` : '')).trim();

    if (!output) return `No differences found against ${ref}.`;

    if (output.length > MAX_DIFF_CHARS) {
      const dropped = output.length - MAX_DIFF_CHARS;
      output = output.slice(0, MAX_DIFF_CHARS) + `\n\n... [${dropped} chars omitted — use statOnly:true or diff a specific path]`;
    }

    return output;
  },
};
