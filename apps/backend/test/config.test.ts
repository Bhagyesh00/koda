import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ── Inline the schema so we can test it without side-effects from config.ts ──

const ConfigSchema = z.object({
  BACKEND_PORT: z.coerce.number().int().positive().default(4001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  AUTH_TOKEN: z.string().min(1).default('dev-secret-change-me'),
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().min(1).default('koda'),
  OLLAMA_NUM_CTX: z.coerce.number().int().positive().default(32768),
  OLLAMA_USERNAME: z.string().optional(),
  OLLAMA_PASSWORD: z.string().optional(),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  SEARXNG_URL: z.string().url().optional(),
  REDIS_URL: z.string().optional(),
  JWT_SECRET: z.string().default('koda_jwt_secret_change_me_in_production'),
  CORS_ORIGIN: z.string().default('http://localhost:4000'),
  DATABASE_URL: z.string().optional(),
});

describe('Config schema — defaults', () => {
  it('parses empty env to defaults', () => {
    const c = ConfigSchema.parse({});
    expect(c.BACKEND_PORT).toBe(4001);
    expect(c.LOG_LEVEL).toBe('info');
    expect(c.AUTH_TOKEN).toBe('dev-secret-change-me');
    expect(c.OLLAMA_MODEL).toBe('koda');
    expect(c.OLLAMA_NUM_CTX).toBe(32768);
  });

  it('coerces BACKEND_PORT from string', () => {
    expect(ConfigSchema.parse({ BACKEND_PORT: '8080' }).BACKEND_PORT).toBe(8080);
  });

  it('rejects non-numeric BACKEND_PORT', () => {
    expect(() => ConfigSchema.parse({ BACKEND_PORT: 'abc' })).toThrow();
  });

  it('rejects invalid LOG_LEVEL', () => {
    expect(() => ConfigSchema.parse({ LOG_LEVEL: 'verbose' })).toThrow();
  });

  it('accepts all valid LOG_LEVEL values', () => {
    for (const level of ['fatal', 'error', 'warn', 'info', 'debug', 'trace']) {
      expect(() => ConfigSchema.parse({ LOG_LEVEL: level })).not.toThrow();
    }
  });

  it('rejects invalid OLLAMA_BASE_URL', () => {
    expect(() => ConfigSchema.parse({ OLLAMA_BASE_URL: 'not-a-url' })).toThrow();
  });

  it('rejects invalid SEARXNG_URL when provided', () => {
    expect(() => ConfigSchema.parse({ SEARXNG_URL: 'not-a-url' })).toThrow();
  });

  it('accepts valid SEARXNG_URL', () => {
    const c = ConfigSchema.parse({ SEARXNG_URL: 'http://localhost:8888' });
    expect(c.SEARXNG_URL).toBe('http://localhost:8888');
  });

  it('omits optional keys when not provided', () => {
    const c = ConfigSchema.parse({});
    expect(c.DATABASE_URL).toBeUndefined();
    expect(c.BRAVE_SEARCH_API_KEY).toBeUndefined();
    expect(c.OLLAMA_USERNAME).toBeUndefined();
    expect(c.SEARXNG_URL).toBeUndefined();
    expect(c.REDIS_URL).toBeUndefined();
  });

  it('uses custom AUTH_TOKEN when provided', () => {
    const c = ConfigSchema.parse({ AUTH_TOKEN: 'my-secret' });
    expect(c.AUTH_TOKEN).toBe('my-secret');
  });

  it('rejects empty AUTH_TOKEN', () => {
    expect(() => ConfigSchema.parse({ AUTH_TOKEN: '' })).toThrow();
  });

  it('coerces OLLAMA_NUM_CTX from string', () => {
    const c = ConfigSchema.parse({ OLLAMA_NUM_CTX: '16384' });
    expect(c.OLLAMA_NUM_CTX).toBe(16384);
  });

  it('uses default JWT_SECRET', () => {
    const c = ConfigSchema.parse({});
    expect(c.JWT_SECRET).toBe('koda_jwt_secret_change_me_in_production');
  });
});
