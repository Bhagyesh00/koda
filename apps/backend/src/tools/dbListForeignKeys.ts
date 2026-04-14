import { DbListForeignKeysArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { dbQuery, resolveConnectionString, detectDbType } from '../sandbox/db.js';

export const dbListForeignKeysTool: Tool<DbListForeignKeysArgs> = {
  name: 'db_list_foreign_keys',
  description: 'Show foreign key constraints and the tables they reference.',
  requiresApproval: false,
  schema: DbListForeignKeysArgs,

  async run(args, ctx) {
    const conn = resolveConnectionString(args.connectionString);
    const dbType = detectDbType(conn);

    switch (dbType) {
      case 'postgresql': {
        let sql = `
          SELECT
            kcu.constraint_name,
            kcu.table_name,
            kcu.column_name,
            ccu.table_name AS foreign_table,
            ccu.column_name AS foreign_column
          FROM information_schema.key_column_usage kcu
          JOIN information_schema.constraint_column_usage ccu
            ON kcu.constraint_name = ccu.constraint_name
          WHERE kcu.constraint_name IN (
            SELECT constraint_name FROM information_schema.referential_constraints
          )
        `.trim();
        if (args.table) {
          sql += ` AND kcu.table_name = '${args.table}'`;
        }
        sql += ' ORDER BY kcu.table_name, kcu.constraint_name';

        const result = await dbQuery(conn, sql, undefined, ctx.workDir);
        return formatFkRows(result.rows, args.table);
      }

      case 'mysql': {
        let sql = `
          SELECT
            CONSTRAINT_NAME,
            TABLE_NAME,
            COLUMN_NAME,
            REFERENCED_TABLE_NAME,
            REFERENCED_COLUMN_NAME
          FROM information_schema.KEY_COLUMN_USAGE
          WHERE REFERENCED_TABLE_NAME IS NOT NULL
            AND TABLE_SCHEMA = DATABASE()
        `.trim();
        if (args.table) {
          sql += ` AND TABLE_NAME = '${args.table}'`;
        }
        sql += ' ORDER BY TABLE_NAME, CONSTRAINT_NAME';

        const result = await dbQuery(conn, sql, undefined, ctx.workDir);
        return formatFkRows(result.rows, args.table);
      }

      case 'sqlite': {
        // Get the list of tables to query
        let tables: string[] = [];
        if (args.table) {
          tables = [args.table];
        } else {
          const tablesResult = await dbQuery(
            conn,
            `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
            undefined,
            ctx.workDir,
          );
          tables = tablesResult.rows.map((r) => String(r['name'] ?? ''));
        }

        const allRows: Record<string, unknown>[] = [];
        for (const table of tables) {
          const fkResult = await dbQuery(
            conn,
            `PRAGMA foreign_key_list(${table})`,
            undefined,
            ctx.workDir,
          );
          for (const row of fkResult.rows) {
            allRows.push({
              table_name: table,
              constraint_id: row['id'],
              column_name: row['from'],
              foreign_table: row['table'],
              foreign_column: row['to'],
              on_update: row['on_update'],
              on_delete: row['on_delete'],
            });
          }
        }

        return formatFkRows(allRows, args.table);
      }
    }
  },
};

function formatFkRows(rows: Record<string, unknown>[], table?: string): string {
  if (rows.length === 0) {
    return table
      ? `No foreign keys found for table '${table}'.`
      : 'No foreign keys found.';
  }
  return rows
    .map((row) =>
      Object.entries(row)
        .map(([k, v]) => `${k}: ${v ?? 'NULL'}`)
        .join(' | '),
    )
    .join('\n');
}
