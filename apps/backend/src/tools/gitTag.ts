import { GitTagArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const gitTagTool: Tool<typeof GitTagArgs._type> = {
  name: 'git_tag',
  description: 'List, create, or delete git tags.',
  requiresApproval: false,
  schema: GitTagArgs,

  async run(args, ctx) {
    const check = await runShell('git rev-parse --is-inside-work-tree', {
      cwd: ctx.workDir,
      timeoutMs: 5_000,
    });
    if (check.exitCode !== 0) {
      return 'Not a git repository (or no git installed).';
    }

    const action = args.action ?? 'list';

    let cmd: string;
    switch (action) {
      case 'list':
        cmd = 'git tag -l --sort=-creatordate';
        break;

      case 'create':
        if (!args.name) return 'Tag name is required for create action.';
        if (args.message) {
          cmd = `git tag -a "${shellEscape(args.name)}" -m "${shellEscape(args.message)}" ${args.ref ? shellEscape(args.ref) : ''}`;
        } else {
          cmd = `git tag "${shellEscape(args.name)}" ${args.ref ? shellEscape(args.ref) : ''}`;
        }
        break;

      case 'delete':
        if (!args.name) return 'Tag name is required for delete action.';
        cmd = `git tag -d "${shellEscape(args.name)}"`;
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
