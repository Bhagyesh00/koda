import { AwsArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const awsTool: Tool<typeof AwsArgs._type> = {
  name: 'aws',
  description:
    'Run AWS CLI commands (s3, ec2, lambda, ecs, cloudwatch, etc).',
  requiresApproval: false,
  schema: AwsArgs,

  async run(args, ctx) {
    const service = shellEscape(args.service);
    const command = shellEscape(args.command);
    const region = args.region ? ` --region "${shellEscape(args.region)}"` : '';
    const profile = args.profile ? ` --profile "${shellEscape(args.profile)}"` : '';

    const cmd = `aws ${service} ${command}${region}${profile} --output json`;

    const result = await runShell(cmd, { cwd: ctx.workDir, signal: ctx.signal });

    const parts: string[] = [];
    parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    return parts.join('\n');
  },
};
