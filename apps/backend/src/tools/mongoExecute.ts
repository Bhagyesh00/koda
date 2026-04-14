import { MongoExecuteArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const mongoExecuteTool: Tool<typeof MongoExecuteArgs._type> = {
  name: 'mongo_execute',
  description:
    'Run MongoDB write commands (insert, update, delete, createIndex) via mongosh. Requires approval.',
  requiresApproval: true,
  schema: MongoExecuteArgs,

  async run(args, ctx) {
    const connStr = shellEscape(args.connectionString);
    const db = shellEscape(args.database);
    const command = shellEscape(args.command);
    const cmd = `mongosh "${connStr}/${db}" --quiet --eval "${command}"`;

    const result = await runShell(cmd, { cwd: ctx.workDir, signal: ctx.signal });

    const parts: string[] = [];
    parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    return parts.join('\n');
  },
};
