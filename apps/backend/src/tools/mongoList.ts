import { MongoListArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const mongoListTool: Tool<typeof MongoListArgs._type> = {
  name: 'mongo_list',
  description:
    'List MongoDB databases or collections within a database.',
  requiresApproval: false,
  schema: MongoListArgs,

  async run(args, ctx) {
    const connStr = shellEscape(args.connectionString);
    let cmd: string;

    if (args.database) {
      const db = shellEscape(args.database);
      cmd = `mongosh "${connStr}/${db}" --quiet --eval "${shellEscape('db.getCollectionNames()')}"`;
    } else {
      cmd = `mongosh "${connStr}" --quiet --eval "${shellEscape('db.adminCommand({listDatabases:1}).databases.map(d=>d.name)')}"`;
    }

    const result = await runShell(cmd, { cwd: ctx.workDir, signal: ctx.signal });

    const parts: string[] = [];
    parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    return parts.join('\n');
  },
};
