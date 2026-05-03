import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../logger.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool | null {
  return pool;
}

export function isPoolAvailable(): boolean {
  return pool !== null;
}

export async function initPool(): Promise<void> {
  if (!config.DATABASE_URL) return;
  pool = new Pool({
    connectionString: config.DATABASE_URL,
    // Cap any individual statement so a stuck query can't pin a connection forever.
    statement_timeout: 30_000,
    // Bound how long a connection can wait in the pool queue before throwing.
    connectionTimeoutMillis: 10_000,
    // Enable TLS when a hosted DB is used (Heroku, Supabase, RDS) — disable cert check
    // is intentional for self-signed dev/managed-DB chains; tighten if you control the CA.
    ssl: /sslmode=require|sslmode=verify/.test(config.DATABASE_URL)
      ? { rejectUnauthorized: false }
      : undefined,
  });
  // Without this handler an idle-client error (network blip, DB restart) becomes
  // an unhandled 'error' event on the Pool and crashes the Node process.
  pool.on('error', (err) => {
    logger.error({ err }, 'postgres pool idle-client error');
  });
  // Verify connectivity
  const client = await pool.connect();
  client.release();
  logger.info('database connected');
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  if (!pool) throw new Error('Database pool not initialised');
  return pool.query<T>(sql, params);
}
