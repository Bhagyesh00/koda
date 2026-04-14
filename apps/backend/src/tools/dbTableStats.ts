import { DbTableStatsArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { dbQuery, resolveConnectionString, detectDbType } from '../sandbox/db.js';

export const dbTableStatsTool: Tool<DbTableStatsArgs> = {
  name: 'db_table_stats',
  description:
    'Show row count, dead tuples, last vacuum/analyze, and bloat estimate for a table.',
  requiresApproval: false,
  schema: DbTableStatsArgs,

  async run(args, ctx) {
    const conn = resolveConnectionString(args.connectionString);
    const dbType = detectDbType(conn);

    switch (dbType) {
      case 'postgresql': {
        const sql = `
          SELECT
            reltuples::bigint AS row_estimate,
            n_dead_tup,
            last_vacuum,
            last_autovacuum,
            last_analyze
          FROM pg_stat_user_tables
          WHERE relname = '${args.table}'
        `.trim();
        const result = await dbQuery(conn, sql, undefined, ctx.workDir);
        if (result.rows.length === 0) {
          return `No stats found for table '${args.table}'. Table may not exist or has never been analyzed.`;
        }
        return JSON.stringify(result.rows[0], null, 2);
      }

      case 'mysql': {
        const sql = `
          SELECT TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH, DATA_FREE
          FROM information_schema.TABLES
          WHERE TABLE_NAME = '${args.table}'
            AND TABLE_SCHEMA = DATABASE()
        `.trim();
        const result = await dbQuery(conn, sql, undefined, ctx.workDir);
        if (result.rows.length === 0) {
          return `No stats found for table '${args.table}'.`;
        }
        return JSON.stringify(result.rows[0], null, 2);
      }

      case 'sqlite': {
        const sql = `SELECT COUNT(*) as row_count FROM ${args.table}`;
        const result = await dbQuery(conn, sql, undefined, ctx.workDir);
        if (result.rows.length === 0) {
          return `Unable to count rows in table '${args.table}'.`;
        }
        return JSON.stringify(
          { table: args.table, ...result.rows[0], note: 'SQLite provides basic row count only.' },
          null,
          2,
        );
      }
    }
  },
};
