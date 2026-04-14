import { AzureArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const azureTool: Tool<typeof AzureArgs._type> = {
  name: 'azure',
  description:
    'Run Azure CLI (az) commands.',
  requiresApproval: false,
  schema: AzureArgs,

  async run(args, ctx) {
    const command = shellEscape(args.command);
    const subscription = args.subscription
      ? ` --subscription "${shellEscape(args.subscription)}"`
      : '';

    const cmd = `az ${command}${subscription} --output json`;

    const result = await runShell(cmd, { cwd: ctx.workDir, signal: ctx.signal });

    const parts: string[] = [];
    parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    return parts.join('\n');
  },
};
