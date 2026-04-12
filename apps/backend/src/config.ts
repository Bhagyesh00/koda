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
  BACKEND_PORT: z.coerce.number().int().positive().default(8787),
  WORK_DIR: z.string().default('./workspace'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  AUTH_TOKEN: z.string().min(1).default('dev-secret-change-me'),
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().min(1).default('gemma4:e4b'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
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
