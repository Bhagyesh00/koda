import path from 'node:path';
import { DbRestoreArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { resolveConnectionString, detectDbType } from '../sandbox/db.js';
import { runShell } from '../sandbox/exec.js';
import { resolveInside } from '../sandbox/fs.js';

export const dbRestoreTool: Tool<DbRestoreArgs> = {
  name: 'db_restore',
  description: 'Restore a database from a SQL dump file. Requires user approval.',
  requiresApproval: true,
  schema: DbRestoreArgs,

  async run(args, ctx) {
    const conn = resolveConnectionString(args.connectionString);
    const absPath = resolveInside(ctx.workDir, args.inputPath);
    const dbType = detectDbType(conn);

    let cmd: string;
    switch (dbType) {
      case 'postgresql': {
        cmd = `psql "${conn}" -f "${absPath}"`;
        break;
      }
      case 'mysql': {
        cmd = `mysql "${conn}" < "${absPath}"`;
        break;
      }
      case 'sqlite': {
        const dbPath = conn.startsWith('sqlite://')
          ? conn.slice('sqlite://'.length)
          : conn;
        const absDbPath = path.isAbsolute(dbPath)
          ? dbPath
          : path.resolve(ctx.workDir, dbPath);
        cmd = `sqlite3 "${absDbPath}" < "${absPath}"`;
        break;
      }
    }

    const result = await runShell(cmd, { cwd: ctx.workDir, timeoutMs: 300_000 });
    if (!result.ok) {
      throw new Error(
        `db_restore failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
      );
    }

    return `Restored from ${args.inputPath}`;
  },
};
