import { BashArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

export const bashTool: Tool<typeof BashArgs._type> = {
  name: 'bash',
  description: 'Run a shell command in the working directory. Requires user approval.',
  requiresApproval: true,
  schema: BashArgs,
  async run(args, ctx) {
    const result = await runShell(args.command, { cwd: ctx.workDir, timeoutMs: args.timeoutMs });
    const parts: string[] = [];
    parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    return parts.join('\n');
  },
};
