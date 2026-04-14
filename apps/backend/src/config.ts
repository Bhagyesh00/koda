import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';

// Find the nearest .env by walking up from cwd. This matters in the monorepo:
// when the backend is started with `pnpm --filter @koda/backend dev`, cwd is
// apps/backend, but the real .env lives at the repo root. Plain `dotenv/config`
// would silently miss it and fall back to schema defaults (e.g. port 8787
// instead of the configured 4001).
function findEnvFile(): string | undefined {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
loadDotenv({ path: findEnvFile() });

const ConfigSchema = z.object({
  BACKEND_PORT: z.coerce.number().int().positive().default(4001),
  WORK_DIR: z.string().default('./workspace'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  AUTH_TOKEN: z.string().min(1).default('dev-secret-change-me'),
  OLLAMA_BASE_URL: z.string().url().default('http://103.186.18.11:11434'),
  OLLAMA_MODEL: z.string().min(1).default('koda'),
  /** Context window size passed to Ollama. Increase for larger codebases. */
  OLLAMA_NUM_CTX: z.coerce.number().int().positive().default(32768),
  /** Optional HTTP Basic Auth credentials for a password-protected Ollama server. */
  OLLAMA_USERNAME: z.string().optional(),
  OLLAMA_PASSWORD: z.string().optional(),
  /**
   * Optional Brave Search API key for web_search.
   * When absent, the tool falls back to DuckDuckGo HTML scraping (no key needed).
   * Get a free key at https://brave.com/search/api/
   */
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  CORS_ORIGIN: z.string().default('http://localhost:4000'),
});

const parsed = ConfigSchema.parse(process.env);

const workDirAbs = path.resolve(process.cwd(), parsed.WORK_DIR);
if (!fs.existsSync(workDirAbs)) {
  fs.mkdirSync(workDirAbs, { recursive: true });
}

export const config = {
  ...parsed,
  WORK_DIR_ABS: workDirAbs,
} as const;

export type Config = typeof config;
