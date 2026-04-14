import { DynamodbArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const dynamodbTool: Tool<typeof DynamodbArgs._type> = {
  name: 'dynamodb',
  description:
    'Run DynamoDB operations (query, scan, get-item, put-item, etc) via AWS CLI.',
  requiresApproval: false,
  schema: DynamodbArgs,

  async run(args, ctx) {
    const operation = shellEscape(args.operation);
    const tablePart = args.tableName ? `--table-name ${shellEscape(args.tableName)}` : '';
    const paramsPart = args.params ?? '';
    const regionPart = args.region ? `--region ${shellEscape(args.region)}` : '';
    const endpointPart = args.endpoint ? `--endpoint-url ${shellEscape(args.endpoint)}` : '';

    const cmd = `aws dynamodb ${operation} ${tablePart} ${paramsPart} ${regionPart} ${endpointPart} --output json`.trim();

    const result = await runShell(cmd, { cwd: ctx.workDir, signal: ctx.signal });

    const parts: string[] = [];
    parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    if (result.stdout) {
      // Try to pretty-print JSON output
      try {
        parts.push(JSON.stringify(JSON.parse(result.stdout), null, 2));
      } catch {
        parts.push(result.stdout);
      }
    }
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    return parts.join('\n');
  },
};
