import { MongoQueryArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const mongoQueryTool: Tool<typeof MongoQueryArgs._type> = {
  name: 'mongo_query',
  description:
    'Run a read-only MongoDB find query via mongosh. Returns JSON documents.',
  requiresApproval: false,
  schema: MongoQueryArgs,

  async run(args, ctx) {
    const filter = shellEscape(args.filter ?? '{}');
    const projection = args.projection ? shellEscape(args.projection) : undefined;
    const sort = args.sort ? shellEscape(args.sort) : undefined;
    const collection = shellEscape(args.collection);
    const limit = args.limit ?? 20;

    let evalExpr = `db.${collection}.find(${filter}`;
    if (projection) evalExpr += `, ${projection}`;
    evalExpr += ')';
    if (sort) evalExpr += `.sort(${sort})`;
    evalExpr += `.limit(${limit}).toArray()`;

    const connStr = shellEscape(args.connectionString);
    const db = shellEscape(args.database);
    const cmd = `mongosh "${connStr}/${db}" --quiet --eval "${shellEscape(evalExpr)}"`;

    const result = await runShell(cmd, { cwd: ctx.workDir, signal: ctx.signal });

    const parts: string[] = [];
    parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    return parts.join('\n');
  },
};
