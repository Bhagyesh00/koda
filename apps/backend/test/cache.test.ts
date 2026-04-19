import { describe, it, expect, beforeEach } from 'vitest';
import { getCached, setCached, delCached, isRedisAvailable } from '../src/cache/redis.js';

// These tests run against a real Redis if REDIS_URL is set,
// otherwise verify graceful no-op behaviour.

describe('Redis cache — no-op when Redis unavailable', () => {
  it('getCached returns null when Redis is not connected', async () => {
    if (isRedisAvailable()) return; // skip if Redis is live
    const result = await getCached('test-key');
    expect(result).toBeNull();
  });

  it('setCached does not throw when Redis is not connected', async () => {
    if (isRedisAvailable()) return;
    await expect(setCached('test-key', 'value', 60)).resolves.toBeUndefined();
  });

  it('delCached does not throw when Redis is not connected', async () => {
    if (isRedisAvailable()) return;
    await expect(delCached('test-key')).resolves.toBeUndefined();
  });
});

describe('Redis cache — live operations (skipped if Redis not available)', () => {
  const KEY = `test:cache:${Date.now()}`;

  it('set then get returns the stored value', async () => {
    if (!isRedisAvailable()) return;
    await setCached(KEY, 'hello world', 60);
    const result = await getCached(KEY);
    expect(result).toBe('hello world');
  });

  it('get returns null for unknown key', async () => {
    if (!isRedisAvailable()) return;
    const result = await getCached('cache:nonexistent:' + Math.random());
    expect(result).toBeNull();
  });

  it('delete removes the key', async () => {
    if (!isRedisAvailable()) return;
    await setCached(KEY, 'to-be-deleted', 60);
    await delCached(KEY);
    const result = await getCached(KEY);
    expect(result).toBeNull();
  });

  it('overwrites existing cached value', async () => {
    if (!isRedisAvailable()) return;
    await setCached(KEY, 'first', 60);
    await setCached(KEY, 'second', 60);
    const result = await getCached(KEY);
    expect(result).toBe('second');
  });

  it('stores JSON strings', async () => {
    if (!isRedisAvailable()) return;
    const data = JSON.stringify({ tool: 'web_search', results: ['a', 'b'] });
    await setCached(KEY + ':json', data, 60);
    const result = await getCached(KEY + ':json');
    expect(result).toBe(data);
    const parsed = JSON.parse(result!);
    expect(parsed.tool).toBe('web_search');
  });
});
