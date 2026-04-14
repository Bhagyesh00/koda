import path from 'node:path';
import { DbDumpArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { resolveConnectionString, detectDbType } from '../sandbox/db.js';
import { runShell } from '../sandbox/exec.js';
import { resolveInside } from '../sandbox/fs.js';

export const dbDumpTool: Tool<DbDumpArgs> = {
  name: 'db_dump',
  description: 'Dump database or specific tables to a SQL file.',
  requiresApproval: false,
  schema: DbDumpArgs,

  async run(args, ctx) {
    const conn = resolveConnectionString(args.connectionString);
    const absPath = resolveInside(ctx.workDir, args.outputPath);
    const dbType = detectDbType(conn);

    let cmd: string;
    switch (dbType) {
      case 'postgresql': {
        const tables = args.tables?.map((t) => `-t ${t}`).join(' ') ?? '';
        cmd = `pg_dump "${conn}" ${tables} -f "${absPath}"`.replace(/\s+/g, ' ').trim();
        break;
      }
      case 'mysql': {
        const tableList = args.tables?.join(' ') ?? '';
        cmd = `mysqldump "${conn}" ${tableList} > "${absPath}"`.replace(/\s+/g, ' ').trim();
        break;
      }
      case 'sqlite': {
        // conn is the file path for SQLite (strip sqlite:// prefix if present)
        const dbPath = conn.startsWith('sqlite://')
          ? conn.slice('sqlite://'.length)
          : conn;
        const absDbPath = path.isAbsolute(dbPath)
          ? dbPath
          : path.resolve(ctx.workDir, dbPath);
        cmd = `sqlite3 "${absDbPath}" .dump > "${absPath}"`;
        break;
      }
    }

    const result = await runShell(cmd, { cwd: ctx.workDir, timeoutMs: 120_000 });
    if (!result.ok) {
      throw new Error(
        `db_dump failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
      );
    }

    return `Dumped to ${args.outputPath}`;
  },
};
