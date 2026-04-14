import path from 'node:path';
import { runShell } from './exec.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DbResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  fields?: string[];
}

export type DbType = 'postgresql' | 'mysql' | 'sqlite';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * If `connStr` looks like a bare environment variable name (all uppercase
 * letters, digits, and underscores), resolve it through `process.env`.
 * Otherwise return the string as-is.
 */
export function resolveConnectionString(connStr: string): string {
  if (/^[A-Z][A-Z0-9_]*$/.test(connStr)) {
    return process.env[connStr] ?? connStr;
  }
  return connStr;
}

/** Detect the database engine from the connection string prefix. */
export function detectDbType(connStr: string): DbType {
  const resolved = resolveConnectionString(connStr);
  if (resolved.startsWith('postgres://') || resolved.startsWith('postgresql://')) {
    return 'postgresql';
  }
  if (resolved.startsWith('mysql://')) {
    return 'mysql';
  }
  // Treat anything else (file path or sqlite:// URI) as SQLite
  return 'sqlite';
}

/**
 * Throw if the SQL statement is not a read-only SELECT.
 * Accepts leading comments and whitespace, and is case-insensitive.
 */
export function assertReadOnly(sql: string): void {
  // Strip leading block comments and whitespace, then check first keyword
  const stripped = sql.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!/^select\b/i.test(stripped)) {
    throw new Error(
      `assertReadOnly: only SELECT statements are permitted. Got: ${stripped.slice(0, 80)}`,
    );
  }
}

// ── Internal CLI runners ──────────────────────────────────────────────────────

/**
 * Escape a string so it can be safely embedded inside a double-quoted
 * shell argument. We replace backslashes and double-quotes only; the caller
 * wraps the result in double quotes.
 */
function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function runPostgres(
  connStr: string,
  sql: string,
  workDir: string,
): Promise<DbResult> {
  const escaped = shellEscape(sql);
  const cmd = `psql "${shellEscape(connStr)}" -t -A --csv -c "${escaped}"`;
  const result = await runShell(cmd, { cwd: workDir });

  if (!result.ok) {
    throw new Error(`psql error (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
  }

  const output = result.stdout.trim();
  if (!output) return { rows: [], rowCount: 0 };

  const lines = output.split('\n');
  if (lines.length === 0) return { rows: [], rowCount: 0 };

  // psql --csv: first line is the header row
  const fields = parseCsvLine(lines[0]!);
  const rows: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const values = parseCsvLine(line);
    const row: Record<string, unknown> = {};
    fields.forEach((f, idx) => {
      row[f] = values[idx] ?? null;
    });
    rows.push(row);
  }

  return { rows, rowCount: rows.length, fields };
}

async function runMysql(
  connStr: string,
  sql: string,
  workDir: string,
): Promise<DbResult> {
  const escaped = shellEscape(sql);
  const cmd = `mysql "${shellEscape(connStr)}" -e "${escaped}" --batch --silent`;
  const result = await runShell(cmd, { cwd: workDir });

  if (!result.ok) {
    throw new Error(`mysql error (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
  }

  const output = result.stdout.trim();
  if (!output) return { rows: [], rowCount: 0 };

  const lines = output.split('\n');
  if (lines.length === 0) return { rows: [], rowCount: 0 };

  // MySQL --batch --silent: tab-separated, first line is header
  const fields = lines[0]!.split('\t');
  const rows: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    const values = line.split('\t');
    const row: Record<string, unknown> = {};
    fields.forEach((f, idx) => {
      const v = values[idx];
      row[f] = v === 'NULL' ? null : (v ?? null);
    });
    rows.push(row);
  }

  return { rows, rowCount: rows.length, fields };
}

function resolveSqlitePath(connStr: string, workDir: string): string {
  const dbPath = connStr.startsWith('sqlite://') ? connStr.slice('sqlite://'.length) : connStr;
  return path.isAbsolute(dbPath) ? dbPath : path.resolve(workDir, dbPath);
}

async function runSqlite(
  connStr: string,
  sql: string,
  workDir: string,
): Promise<DbResult> {
  const dbPath = resolveSqlitePath(connStr, workDir);

  const escaped = shellEscape(sql);
  const cmd = `sqlite3 "${shellEscape(dbPath)}" -json "${escaped}"`;
  const result = await runShell(cmd, { cwd: workDir });

  if (!result.ok) {
    throw new Error(`sqlite3 error (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
  }

  const output = result.stdout.trim();
  if (!output || output === '[]') return { rows: [], rowCount: 0 };

  let rows: Record<string, unknown>[];
  try {
    rows = JSON.parse(output) as Record<string, unknown>[];
  } catch {
    throw new Error(`sqlite3 returned non-JSON output: ${output.slice(0, 200)}`);
  }

  const fields = rows.length > 0 ? Object.keys(rows[0]!) : undefined;
  return { rows, rowCount: rows.length, fields };
}

// ── Minimal CSV line parser (handles quoted fields) ───────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        // Check for escaped double-quote ("")
        if (i + 1 < line.length && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        fields.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
  }
  fields.push(cur);
  return fields;
}

// ── Dispatch helpers ──────────────────────────────────────────────────────────

async function dispatch(
  connStr: string,
  sql: string,
  workDir: string,
): Promise<DbResult> {
  const resolved = resolveConnectionString(connStr);
  const dbType = detectDbType(resolved);

  switch (dbType) {
    case 'postgresql':
      return runPostgres(resolved, sql, workDir);
    case 'mysql':
      return runMysql(resolved, sql, workDir);
    case 'sqlite':
      return runSqlite(resolved, sql, workDir);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run a SQL query and return rows as structured data.
 * `params` are interpolated positionally (basic string substitution for CLI
 * tools that don't support bind parameters natively).
 */
export async function dbQuery(
  connStr: string,
  sql: string,
  params?: unknown[],
  workDir = process.cwd(),
): Promise<DbResult> {
  const finalSql = interpolateParams(sql, params);
  return dispatch(connStr, finalSql, workDir);
}

/**
 * Run an INSERT / UPDATE / DELETE / DDL statement and return the affected
 * row count. For SQLite, this wraps the statement in `changes()` to retrieve
 * the count; for PostgreSQL and MySQL the output is parsed from the command
 * status line.
 */
export async function dbExecute(
  connStr: string,
  sql: string,
  params?: unknown[],
  workDir = process.cwd(),
): Promise<{ rowCount: number }> {
  const resolved = resolveConnectionString(connStr);
  const finalSql = interpolateParams(sql, params);
  const dbType = detectDbType(resolved);

  if (dbType === 'postgresql') {
    // psql prints "UPDATE 3" etc. on stderr or stdout — capture it
    const escaped = shellEscape(finalSql);
    const cmd = `psql "${shellEscape(resolved)}" -c "${escaped}"`;
    const result = await runShell(cmd, { cwd: workDir });
    if (!result.ok) {
      throw new Error(`psql error (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
    }
    const match = (result.stdout + result.stderr).match(/\b(\d+)$/m);
    return { rowCount: match ? parseInt(match[1]!, 10) : 0 };
  }

  if (dbType === 'mysql') {
    const escaped = shellEscape(finalSql);
    const cmd = `mysql "${shellEscape(resolved)}" -e "${escaped}" --batch --silent`;
    const result = await runShell(cmd, { cwd: workDir });
    if (!result.ok) {
      throw new Error(`mysql error (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
    }
    // MySQL prints "Query OK, N row(s) affected"
    const match = result.stdout.match(/(\d+) row/);
    return { rowCount: match ? parseInt(match[1]!, 10) : 0 };
  }

  // SQLite — run the statement then query changes()
  const escapedPath = shellEscape(resolveSqlitePath(resolved, workDir));
  const escapedSql = shellEscape(finalSql);
  const cmd = `sqlite3 "${escapedPath}" "${escapedSql}" && sqlite3 "${escapedPath}" "SELECT changes()"`;
  const result = await runShell(cmd, { cwd: workDir });
  if (!result.ok) {
    throw new Error(`sqlite3 error (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
  }
  const rowCount = parseInt(result.stdout.trim(), 10);
  return { rowCount: isNaN(rowCount) ? 0 : rowCount };
}

// ── Parameter interpolation ───────────────────────────────────────────────────

/**
 * Very lightweight positional parameter substitution for CLI drivers that
 * don't support native bind parameters.
 *
 * Detects the placeholder style used in the SQL and applies exactly one pass:
 * - PostgreSQL style: `$1`, `$2`, … → replaced by index
 * - MySQL/SQLite style: `?` → replaced left-to-right
 *
 * Single-pass prevents double-substitution when a replaced value contains
 * the other style's placeholder character.
 *
 * Numbers and booleans are inserted bare; strings are single-quoted with
 * internal single-quotes doubled.
 */
function interpolateParams(sql: string, params?: unknown[]): string {
  if (!params || params.length === 0) return sql;

  function quoteValue(v: unknown): string {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
  }

  // PostgreSQL-style ($1..$N) takes priority when present
  if (/\$\d+/.test(sql)) {
    return sql.replace(/\$(\d+)/g, (_, n) => {
      const idx = parseInt(n, 10) - 1;
      return idx >= 0 && idx < params.length ? quoteValue(params[idx]) : `$${n}`;
    });
  }

  // MySQL/SQLite-style: ? replaced left-to-right
  let paramIdx = 0;
  return sql.replace(/\?/g, () =>
    paramIdx < params.length ? quoteValue(params[paramIdx++]) : '?',
  );
}
