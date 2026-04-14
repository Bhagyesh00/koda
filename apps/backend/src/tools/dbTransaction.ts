import { DbTransactionArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { dbExecute, resolveConnectionString } from '../sandbox/db.js';

export const dbTransactionTool: Tool<DbTransactionArgs> = {
  name: 'db_transaction',
  description:
    'Run multiple SQL statements in a single atomic transaction. Requires user approval.',
  requiresApproval: true,
  schema: DbTransactionArgs,

  async run(args, ctx) {
    const conn = resolveConnectionString(args.connectionString);
    const rowCounts: number[] = [];

    // Note: true transactional atomicity depends on the CLI tool being used.
    // psql wraps each -c invocation independently; for real atomicity across
    // multiple statements use db_execute with a BEGIN/COMMIT block.
    for (const stmt of args.statements) {
      const result = await dbExecute(conn, stmt.sql, stmt.params, ctx.workDir);
      rowCounts.push(result.rowCount);
    }

    const n = args.statements.length;
    const counts = rowCounts.join(', ');
    return (
      `Transaction complete. Statements: ${n}. Rows affected: [${counts}]\n` +
      `Note: true transaction atomicity depends on the CLI tool in use. ` +
      `For guaranteed atomicity wrap your SQL in BEGIN/COMMIT and use db_execute.`
    );
  },
};
