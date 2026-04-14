import { DbConnectionsArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { dbQuery, resolveConnectionString, detectDbType } from '../sandbox/db.js';

export const dbConnectionsTool: Tool<DbConnectionsArgs> = {
  name: 'db_connections',
  description: 'Show active database connections, states, and query duration.',
  requiresApproval: false,
  schema: DbConnectionsArgs,

  async run(args, ctx) {
    const conn = resolveConnectionString(args.connectionString);
    const dbType = detectDbType(conn);

    switch (dbType) {
      case 'postgresql': {
        const sql = `
          SELECT
            pid,
            usename,
            application_name,
            state,
            now() - query_start AS duration,
            query
          FROM pg_stat_activity
          ORDER BY duration DESC NULLS LAST
        `.trim();
        const result = await dbQuery(conn, sql, undefined, ctx.workDir);
        if (result.rows.length === 0) {
          return 'No active connections found.';
        }
        return JSON.stringify(result.rows, null, 2);
      }

      case 'mysql': {
        const result = await dbQuery(conn, 'SHOW PROCESSLIST', undefined, ctx.workDir);
        if (result.rows.length === 0) {
          return 'No active connections found.';
        }
        return JSON.stringify(result.rows, null, 2);
      }

      case 'sqlite': {
        return 'SQLite is embedded — no connection pool.';
      }
    }
  },
};
