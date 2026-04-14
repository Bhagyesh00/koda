import { DbQueryArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { dbQuery, resolveConnectionString, assertReadOnly } from '../sandbox/db.js';

export const dbQueryTool: Tool<DbQueryArgs> = {
  name: 'db_query',
  description: 'Run a read-only SQL SELECT and return rows as JSON.',
  requiresApproval: false,
  schema: DbQueryArgs,

  async run(args, ctx) {
    assertReadOnly(args.sql);
    const conn = resolveConnectionString(args.connectionString);
    const result = await dbQuery(conn, args.sql, args.params, ctx.workDir);
    return JSON.stringify({ rows: result.rows, rowCount: result.rowCount }, null, 2);
  },
};
