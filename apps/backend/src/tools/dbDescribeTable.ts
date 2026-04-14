import { DbDescribeTableArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { dbQuery, resolveConnectionString, detectDbType } from '../sandbox/db.js';

export const dbDescribeTableTool: Tool<DbDescribeTableArgs> = {
  name: 'db_describe_table',
  description: 'Show columns, types, constraints, and defaults for a table.',
  requiresApproval: false,
  schema: DbDescribeTableArgs,

  async run(args, ctx) {
    const conn = resolveConnectionString(args.connectionString);
    const dbType = detectDbType(conn);

    let sql: string;
    switch (dbType) {
      case 'postgresql':
        sql = `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = '${args.table}' ORDER BY ordinal_position`;
        break;
      case 'mysql':
        sql = `DESCRIBE \`${args.table}\``;
        break;
      case 'sqlite':
        sql = `PRAGMA table_info(${args.table})`;
        break;
    }

    const result = await dbQuery(conn, sql, undefined, ctx.workDir);

    if (result.rows.length === 0) {
      return `No columns found for table '${args.table}'. Table may not exist.`;
    }

    // Format header based on db type
    let header: string;
    let divider: string;
    let lines: string[];

    switch (dbType) {
      case 'postgresql': {
        header = `${'column_name'.padEnd(30)} | ${'data_type'.padEnd(20)} | ${'nullable'.padEnd(8)} | column_default`;
        divider = '-'.repeat(header.length);
        lines = result.rows.map((row) =>
          `${String(row['column_name'] ?? '').padEnd(30)} | ${String(row['data_type'] ?? '').padEnd(20)} | ${String(row['is_nullable'] ?? '').padEnd(8)} | ${row['column_default'] ?? ''}`,
        );
        break;
      }
      case 'mysql': {
        header = `${'Field'.padEnd(30)} | ${'Type'.padEnd(25)} | ${'Null'.padEnd(4)} | ${'Key'.padEnd(4)} | ${'Default'.padEnd(15)} | Extra`;
        divider = '-'.repeat(header.length);
        lines = result.rows.map((row) =>
          `${String(row['Field'] ?? '').padEnd(30)} | ${String(row['Type'] ?? '').padEnd(25)} | ${String(row['Null'] ?? '').padEnd(4)} | ${String(row['Key'] ?? '').padEnd(4)} | ${String(row['Default'] ?? '').padEnd(15)} | ${row['Extra'] ?? ''}`,
        );
        break;
      }
      case 'sqlite': {
        header = `${'cid'.padEnd(4)} | ${'name'.padEnd(25)} | ${'type'.padEnd(20)} | ${'notnull'.padEnd(7)} | dflt_value`;
        divider = '-'.repeat(header.length);
        lines = result.rows.map((row) =>
          `${String(row['cid'] ?? '').padEnd(4)} | ${String(row['name'] ?? '').padEnd(25)} | ${String(row['type'] ?? '').padEnd(20)} | ${String(row['notnull'] ?? '').padEnd(7)} | ${row['dflt_value'] ?? ''}`,
        );
        break;
      }
    }

    return [header, divider, ...lines].join('\n');
  },
};
