import { DbExplainArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { dbQuery, resolveConnectionString, detectDbType } from '../sandbox/db.js';

export const dbExplainTool: Tool<DbExplainArgs> = {
  name: 'db_explain',
  description: 'Run EXPLAIN [ANALYZE] on a query and return the execution plan.',
  requiresApproval: false,
  schema: DbExplainArgs,

  async run(args, ctx) {
    const conn = resolveConnectionString(args.connectionString);
    const dbType = detectDbType(conn);

    let explainSql: string;
    switch (dbType) {
      case 'postgresql':
        explainSql = `EXPLAIN ${args.analyze ? 'ANALYZE ' : ''}FORMAT TEXT ${args.sql}`;
        break;
      case 'mysql':
        explainSql = `EXPLAIN ${args.analyze ? 'ANALYZE ' : ''}${args.sql}`;
        break;
      case 'sqlite':
        explainSql = `EXPLAIN ${args.analyze ? 'QUERY PLAN ' : ''}${args.sql}`;
        break;
    }

    const result = await dbQuery(conn, explainSql, undefined, ctx.workDir);

    if (result.rows.length === 0) {
      return 'No explain output returned.';
    }

    // Return the plan as-is — collapse all rows/columns into a readable block
    return result.rows
      .map((row) => Object.values(row).join(' | '))
      .join('\n');
  },
};
