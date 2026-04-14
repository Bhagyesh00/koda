import { DbIndexUsageArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { dbQuery, resolveConnectionString, detectDbType } from '../sandbox/db.js';

export const dbIndexUsageTool: Tool<DbIndexUsageArgs> = {
  name: 'db_index_usage',
  description: 'Show index hit rates — identifies unused indexes.',
  requiresApproval: false,
  schema: DbIndexUsageArgs,

  async run(args, ctx) {
    const conn = resolveConnectionString(args.connectionString);
    const dbType = detectDbType(conn);

    switch (dbType) {
      case 'postgresql': {
        const sql = `
          SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
          FROM pg_stat_user_indexes
          ORDER BY idx_scan ASC
        `.trim();
        const result = await dbQuery(conn, sql, undefined, ctx.workDir);
        if (result.rows.length === 0) {
          return 'No index usage statistics found. Run some queries first.';
        }
        return JSON.stringify(result.rows, null, 2);
      }

      case 'mysql': {
        const sql = `SELECT * FROM sys.schema_unused_indexes`;
        const result = await dbQuery(conn, sql, undefined, ctx.workDir);
        if (result.rows.length === 0) {
          return 'No unused indexes found (or sys schema is not available).';
        }
        return JSON.stringify(result.rows, null, 2);
      }

      case 'sqlite': {
        return 'SQLite does not track index usage statistics.';
      }
    }
  },
};
