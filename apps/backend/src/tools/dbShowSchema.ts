import { DbShowSchemaArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { dbQuery, resolveConnectionString, detectDbType } from '../sandbox/db.js';
import { runShell } from '../sandbox/exec.js';

export const dbShowSchemaTool: Tool<DbShowSchemaArgs> = {
  name: 'db_show_schema',
  description: 'Return full DDL (CREATE TABLE statements) for all tables.',
  requiresApproval: false,
  schema: DbShowSchemaArgs,

  async run(args, ctx) {
    const conn = resolveConnectionString(args.connectionString);
    const dbType = detectDbType(conn);

    switch (dbType) {
      case 'postgresql': {
        // Try pg_dump --schema-only first (most complete DDL)
        const pgDumpResult = await runShell(
          `pg_dump "${conn}" --schema-only --no-owner --no-acl`,
          { cwd: ctx.workDir, timeoutMs: 60_000 },
        );
        if (pgDumpResult.ok && pgDumpResult.stdout.trim()) {
          return pgDumpResult.stdout;
        }

        // Fallback: query information_schema for table definitions
        const tablesResult = await dbQuery(
          conn,
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
          undefined,
          ctx.workDir,
        );
        if (tablesResult.rows.length === 0) return 'No tables found in schema.';

        const parts: string[] = [];
        for (const row of tablesResult.rows) {
          const table = String(row['table_name'] ?? '');
          const colResult = await dbQuery(
            conn,
            `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = '${table}' ORDER BY ordinal_position`,
            undefined,
            ctx.workDir,
          );
          const cols = colResult.rows
            .map((c) => {
              const nullable = c['is_nullable'] === 'NO' ? ' NOT NULL' : '';
              const def = c['column_default'] ? ` DEFAULT ${c['column_default']}` : '';
              return `  ${c['column_name']} ${c['data_type']}${nullable}${def}`;
            })
            .join(',\n');
          parts.push(`CREATE TABLE ${table} (\n${cols}\n);`);
        }
        return parts.join('\n\n');
      }

      case 'mysql': {
        // Get all tables in current database
        const tablesResult = await dbQuery(
          conn,
          `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`,
          undefined,
          ctx.workDir,
        );
        if (tablesResult.rows.length === 0) return 'No tables found.';

        const parts: string[] = [];
        for (const row of tablesResult.rows) {
          const table = String(row['TABLE_NAME'] ?? '');
          const ddlResult = await dbQuery(conn, `SHOW CREATE TABLE \`${table}\``, undefined, ctx.workDir);
          if (ddlResult.rows.length > 0) {
            const ddl = ddlResult.rows[0]!['Create Table'] ?? ddlResult.rows[0]!['Create View'] ?? '';
            parts.push(String(ddl) + ';');
          }
        }
        return parts.join('\n\n');
      }

      case 'sqlite': {
        const result = await dbQuery(
          conn,
          `SELECT sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL ORDER BY name`,
          undefined,
          ctx.workDir,
        );
        if (result.rows.length === 0) return 'No tables found.';
        return result.rows.map((r) => String(r['sql'] ?? '') + ';').join('\n\n');
      }
    }
  },
};
