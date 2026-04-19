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
  pool = new Pool({ connectionString: config.DATABASE_URL });
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
