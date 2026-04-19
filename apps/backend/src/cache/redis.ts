import { createClient } from 'redis';
import { config } from '../config.js';
import { logger } from '../logger.js';

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;
let connected = false;

export async function initRedis(): Promise<void> {
  if (!config.REDIS_URL) return;
  try {
    client = createClient({ url: config.REDIS_URL });
    client.on('error', (err) => logger.warn({ err }, 'redis error'));
    await client.connect();
    connected = true;
    logger.info({ url: config.REDIS_URL }, 'redis connected');
  } catch (err) {
    logger.warn({ err }, 'redis unavailable — caching disabled');
    client = null;
    connected = false;
  }
}

export async function getCached(key: string): Promise<string | null> {
  if (!connected || !client) return null;
  try {
    return await client.get(key);
  } catch {
    return null;
  }
}

export async function setCached(key: string, value: string, ttlSeconds = 300): Promise<void> {
  if (!connected || !client) return;
  try {
    await client.set(key, value, { EX: ttlSeconds });
  } catch { /* ignore */ }
}

export async function delCached(key: string): Promise<void> {
  if (!connected || !client) return;
  try {
    await client.del(key);
  } catch { /* ignore */ }
}

export function isRedisAvailable(): boolean {
  return connected;
}
