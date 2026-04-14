import { DbLocksArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { dbQuery, resolveConnectionString, detectDbType } from '../sandbox/db.js';

export const dbLocksTool: Tool<DbLocksArgs> = {
  name: 'db_locks',
  description: 'List active locks and blocked queries.',
  requiresApproval: false,
  schema: DbLocksArgs,

  async run(args, ctx) {
    const conn = resolveConnectionString(args.connectionString);
    const dbType = detectDbType(conn);

    switch (dbType) {
      case 'postgresql': {
        const sql = `
          SELECT
            pid,
            now() - query_start AS duration,
            query,
            state,
            wait_event_type,
            wait_event
          FROM pg_stat_activity
          WHERE state != 'idle'
          ORDER BY duration DESC NULLS LAST
        `.trim();
        const result = await dbQuery(conn, sql, undefined, ctx.workDir);
        if (result.rows.length === 0) {
          return 'No active locks or non-idle sessions found.';
        }
        return JSON.stringify(result.rows, null, 2);
      }

      case 'mysql': {
        // INNODB_LOCKS was removed in MySQL 8.0; fall back to performance_schema
        const sql = `
          SELECT
            r.trx_id waiting_trx_id,
            r.trx_mysql_thread_id waiting_thread,
            r.trx_query waiting_query,
            b.trx_id blocking_trx_id,
            b.trx_mysql_thread_id blocking_thread,
            b.trx_query blocking_query
          FROM information_schema.INNODB_TRX b
          JOIN information_schema.INNODB_TRX r
            ON r.trx_wait_started IS NOT NULL
          LIMIT 50
        `.trim();
        const result = await dbQuery(conn, sql, undefined, ctx.workDir);
        if (result.rows.length === 0) {
          return 'No active InnoDB locks found.';
        }
        return JSON.stringify(result.rows, null, 2);
      }

      case 'sqlite': {
        return 'SQLite uses file-level locking — no lock details available.';
      }
    }
  },
};
