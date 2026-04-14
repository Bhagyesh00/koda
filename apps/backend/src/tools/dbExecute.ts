import { DbExecuteArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { dbExecute, resolveConnectionString } from '../sandbox/db.js';

export const dbExecuteTool: Tool<DbExecuteArgs> = {
  name: 'db_execute',
  description: 'Run an INSERT / UPDATE / DELETE / DDL statement. Requires user approval.',
  requiresApproval: true,
  schema: DbExecuteArgs,

  async run(args, ctx) {
    const conn = resolveConnectionString(args.connectionString);
    const result = await dbExecute(conn, args.sql, args.params, ctx.workDir);
    return `Affected ${result.rowCount} row(s)`;
  },
};
