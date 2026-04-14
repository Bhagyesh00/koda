import { DbListIndexesArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { dbQuery, resolveConnectionString, detectDbType } from '../sandbox/db.js';

export const dbListIndexesTool: Tool<DbListIndexesArgs> = {
  name: 'db_list_indexes',
  description: 'List indexes — name, columns, type, uniqueness.',
  requiresApproval: false,
  schema: DbListIndexesArgs,

  async run(args, ctx) {
    const conn = resolveConnectionString(args.connectionString);
    const dbType = detectDbType(conn);

    let sql: string;
    switch (dbType) {
      case 'postgresql':
        sql = `SELECT indexname, tablename, indexdef FROM pg_indexes${args.table ? ` WHERE tablename = '${args.table}'` : ''} ORDER BY tablename, indexname`;
        break;
      case 'mysql':
        // SHOW INDEX requires a table — fall back to information_schema if none provided
        sql = args.table
          ? `SHOW INDEX FROM \`${args.table}\``
          : `SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE, INDEX_TYPE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME`;
        break;
      case 'sqlite':
        sql = `SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index'${args.table ? ` AND tbl_name = '${args.table}'` : ''} ORDER BY tbl_name, name`;
        break;
    }

    const result = await dbQuery(conn, sql, undefined, ctx.workDir);

    if (result.rows.length === 0) {
      return args.table
        ? `No indexes found for table '${args.table}'.`
        : 'No indexes found.';
    }

    // Format as a simple aligned output
    const lines = result.rows.map((row) =>
      Object.entries(row)
        .map(([k, v]) => `${k}: ${v ?? 'NULL'}`)
        .join(' | '),
    );

    return lines.join('\n');
  },
};
