import { GitStashArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const gitStashTool: Tool<typeof GitStashArgs._type> = {
  name: 'git_stash',
  description: 'Save, restore, list, or drop git stashes.',
  requiresApproval: false,
  schema: GitStashArgs,

  async run(args, ctx) {
    const check = await runShell('git rev-parse --is-inside-work-tree', {
      cwd: ctx.workDir,
      timeoutMs: 5_000,
    });
    if (check.exitCode !== 0) {
      return 'Not a git repository (or no git installed).';
    }

    const action = args.action ?? 'list';
    const stashRef = args.index !== undefined ? `stash@{${args.index}}` : '';

    let cmd: string;
    switch (action) {
      case 'push':
        cmd = `git stash push${args.message ? ` -m "${shellEscape(args.message)}"` : ''}`;
        break;

      case 'pop':
        cmd = `git stash pop ${stashRef}`;
        break;

      case 'list':
        cmd = 'git stash list';
        break;

      case 'drop':
        cmd = `git stash drop ${stashRef}`;
        break;

      case 'show':
        cmd = `git stash show -p ${stashRef}`;
        break;

      default:
        return `Unknown action: ${action}`;
    }

    const result = await runShell(cmd.trim(), { cwd: ctx.workDir, signal: ctx.signal });

    const parts: string[] = [];
    parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    return parts.join('\n');
  },
};
