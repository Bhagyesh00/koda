import { DbListTablesArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { dbQuery, resolveConnectionString, detectDbType } from '../sandbox/db.js';

export const dbListTablesTool: Tool<DbListTablesArgs> = {
  name: 'db_list_tables',
  description: 'List all tables and views in the database.',
  requiresApproval: false,
  schema: DbListTablesArgs,

  async run(args, ctx) {
    const conn = resolveConnectionString(args.connectionString);
    const dbType = detectDbType(conn);

    let sql: string;
    switch (dbType) {
      case 'postgresql':
        sql = `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = COALESCE('${args.schema ?? 'public'}', 'public') ORDER BY table_name`;
        break;
      case 'mysql':
        sql = `SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`;
        break;
      case 'sqlite':
        sql = `SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name`;
        break;
    }

    const result = await dbQuery(conn, sql, undefined, ctx.workDir);

    if (result.rows.length === 0) {
      return 'No tables found.';
    }

    // Build a formatted table string
    const colA = dbType === 'sqlite' ? 'name' : dbType === 'mysql' ? 'TABLE_NAME' : 'table_name';
    const colB = dbType === 'sqlite' ? 'type' : dbType === 'mysql' ? 'TABLE_TYPE' : 'table_type';

    const header = `${'table_name'.padEnd(40)} | table_type`;
    const divider = '-'.repeat(header.length);
    const rows = result.rows.map((row) => {
      const name = String(row[colA] ?? '');
      const type = String(row[colB] ?? '');
      return `${name.padEnd(40)} | ${type}`;
    });

    return [header, divider, ...rows].join('\n');
  },
};
