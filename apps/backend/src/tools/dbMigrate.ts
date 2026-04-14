import fs from 'node:fs';
import path from 'node:path';
import { DbMigrateArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { dbQuery, dbExecute, resolveConnectionString } from '../sandbox/db.js';
import { resolveInside } from '../sandbox/fs.js';

const CREATE_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS _koda_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )
`.trim();

export const dbMigrateTool: Tool<DbMigrateArgs> = {
  name: 'db_migrate',
  description: 'Run pending migration files up or down. Requires user approval.',
  requiresApproval: true,
  schema: DbMigrateArgs,

  async run(args, ctx) {
    const conn = resolveConnectionString(args.connectionString);
    const direction = args.direction ?? 'up';

    // Resolve and validate migrations directory
    const migrationsAbsDir = resolveInside(ctx.workDir, args.migrationsDir);
    if (!fs.existsSync(migrationsAbsDir)) {
      throw new Error(`Migrations directory not found: ${args.migrationsDir}`);
    }

    // Ensure _koda_migrations tracking table exists
    await dbExecute(conn, CREATE_MIGRATIONS_TABLE, undefined, ctx.workDir);

    // Fetch already-applied migrations
    const appliedResult = await dbQuery(
      conn,
      'SELECT name FROM _koda_migrations ORDER BY name ASC',
      undefined,
      ctx.workDir,
    );
    const appliedSet = new Set(appliedResult.rows.map((r) => String(r['name'] ?? '')));

    // Collect .sql files from the migrations directory
    const allFiles = fs
      .readdirSync(migrationsAbsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort(); // ascending lexicographic order

    if (allFiles.length === 0) {
      return `No .sql migration files found in '${args.migrationsDir}'.`;
    }

    let filesToRun: string[];
    if (direction === 'up') {
      filesToRun = allFiles.filter((f) => !appliedSet.has(f));
    } else {
      // down: run applied files in reverse order (last applied first)
      filesToRun = allFiles.filter((f) => appliedSet.has(f)).reverse();
    }

    if (filesToRun.length === 0) {
      return direction === 'up'
        ? 'All migrations are already applied. Nothing to do.'
        : 'No applied migrations to roll back.';
    }

    const applied: string[] = [];
    const failed: string[] = [];

    for (const fileName of filesToRun) {
      const filePath = path.join(migrationsAbsDir, fileName);
      const sql = fs.readFileSync(filePath, 'utf-8').trim();

      if (!sql) {
        applied.push(`${fileName} (skipped — empty file)`);
        continue;
      }

      try {
        await dbExecute(conn, sql, undefined, ctx.workDir);

        if (direction === 'up') {
          // Record migration as applied
          await dbExecute(
            conn,
            `INSERT INTO _koda_migrations (name, applied_at) VALUES ('${fileName.replace(/'/g, "''")}', '${new Date().toISOString()}')`,
            undefined,
            ctx.workDir,
          );
        } else {
          // Remove migration record
          await dbExecute(
            conn,
            `DELETE FROM _koda_migrations WHERE name = '${fileName.replace(/'/g, "''")}'`,
            undefined,
            ctx.workDir,
          );
        }

        applied.push(fileName);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failed.push(`${fileName}: ${msg}`);
        // Stop on first failure to avoid inconsistent state
        break;
      }
    }

    const lines: string[] = [
      `Migration direction: ${direction}`,
      `Applied (${applied.length}): ${applied.length > 0 ? applied.join(', ') : 'none'}`,
    ];

    if (failed.length > 0) {
      lines.push(`Failed (${failed.length}):`);
      failed.forEach((f) => lines.push(`  - ${f}`));
    }

    return lines.join('\n');
  },
};
