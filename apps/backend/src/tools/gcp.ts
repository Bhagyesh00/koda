import { GcpArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const gcpTool: Tool<typeof GcpArgs._type> = {
  name: 'gcp',
  description:
    'Run Google Cloud CLI (gcloud) commands.',
  requiresApproval: false,
  schema: GcpArgs,

  async run(args, ctx) {
    const command = shellEscape(args.command);
    const project = args.project ? ` --project "${shellEscape(args.project)}"` : '';

    const cmd = `gcloud ${command}${project} --format=json`;

    const result = await runShell(cmd, { cwd: ctx.workDir, signal: ctx.signal });

    const parts: string[] = [];
    parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    return parts.join('\n');
  },
};
