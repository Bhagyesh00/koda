import { DbSlowQueriesArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { dbQuery, resolveConnectionString, detectDbType } from '../sandbox/db.js';

export const dbSlowQueriesTool: Tool<DbSlowQueriesArgs> = {
  name: 'db_slow_queries',
  description:
    'Fetch the top N slowest queries from pg_stat_statements or the slow query log.',
  requiresApproval: false,
  schema: DbSlowQueriesArgs,

  async run(args, ctx) {
    const conn = resolveConnectionString(args.connectionString);
    const dbType = detectDbType(conn);
    const limit = args.limit ?? 10;

    switch (dbType) {
      case 'postgresql': {
        const sql = `
          SELECT query, calls, total_exec_time, mean_exec_time, rows
          FROM pg_stat_statements
          ORDER BY total_exec_time DESC
          LIMIT ${limit}
        `.trim();
        const result = await dbQuery(conn, sql, undefined, ctx.workDir);
        return JSON.stringify(result.rows, null, 2);
      }

      case 'mysql': {
        const sql = `
          SELECT
            DIGEST_TEXT AS query,
            COUNT_STAR AS calls,
            SUM_TIMER_WAIT / 1000000000000.0 AS total_exec_time_s,
            AVG_TIMER_WAIT / 1000000000000.0 AS mean_exec_time_s,
            SUM_ROWS_SENT AS rows
          FROM performance_schema.events_statements_summary_by_digest
          ORDER BY SUM_TIMER_WAIT DESC
          LIMIT ${limit}
        `.trim();
        const result = await dbQuery(conn, sql, undefined, ctx.workDir);
        return JSON.stringify(result.rows, null, 2);
      }

      case 'sqlite': {
        return 'SQLite does not have a slow query log.';
      }
    }
  },
};
