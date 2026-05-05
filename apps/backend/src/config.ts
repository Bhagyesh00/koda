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
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().min(1).default('koda'),
  /** Context window size passed to Ollama. Increase for larger codebases. */
  OLLAMA_NUM_CTX: z.coerce.number().int().positive().default(32768),
  /**
   * Soft cap on bytes of `thinking`-channel output per single LLM response.
   * When exceeded, streamOllamaChat closes the <think> tag and stops forwarding
   * further thinking deltas (the model can still emit tool calls or content).
   * Caller is notified via onThinkingBudgetExceeded so it can inject a "make a
   * decision now" hint into the next loop iteration. ~16 000 chars ≈ 4 000 tokens.
   * Set to 0 to disable the cap entirely.
   */
  OLLAMA_THINK_BUDGET_BYTES: z.coerce.number().int().min(0).default(16_000),
  /** Optional HTTP Basic Auth credentials for a password-protected Ollama server. */
  OLLAMA_USERNAME: z.string().optional(),
  OLLAMA_PASSWORD: z.string().optional(),
  /**
   * Optional Brave Search API key for web_search.
   * When absent, the tool falls back to DuckDuckGo HTML scraping (no key needed).
   * Get a free key at https://brave.com/search/api/
   */
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  /** SearxNG base URL — set automatically in Docker Compose (http://searxng:8080) */
  SEARXNG_URL: z.string().url().optional(),
  /** Redis connection URL for tool output caching */
  REDIS_URL: z.string().optional(),
  /** JWT signing secret for multi-user auth */
  JWT_SECRET: z.string().default('koda_jwt_secret_change_me_in_production'),
  /**
   * Base URL for AUTOMATIC1111 Stable Diffusion WebUI (local image generation).
   * Start A1111 with --api flag: python launch.py --api
   * Default: http://localhost:7860
   */
  SD_BASE_URL: z.string().url().default('http://localhost:7860'),
  /** Stable Diffusion model checkpoint name (must match name shown in A1111 UI) */
  SD_MODEL: z.string().optional(),
  /** Default image width in pixels */
  SD_WIDTH: z.coerce.number().int().positive().default(512),
  /** Default image height in pixels */
  SD_HEIGHT: z.coerce.number().int().positive().default(512),
  /** Number of diffusion steps — higher = better quality, slower */
  SD_STEPS: z.coerce.number().int().positive().default(20),
  /** Classifier-free guidance scale — how closely to follow the prompt */
  SD_CFG_SCALE: z.coerce.number().positive().default(7),
  /** Sampler algorithm */
  SD_SAMPLER: z.string().default('DPM++ 2M Karras'),
  /** Default negative prompt appended to every generation */
  SD_NEGATIVE_PROMPT: z.string().default('blurry, bad quality, watermark, text, deformed'),
  /** OpenAI-compatible TTS endpoint. When set, enables the /v1/tts route and tts_speak tool. */
  TTS_BASE_URL: z.string().url().optional(),
  TTS_API_KEY: z.string().optional(),
  TTS_MODEL: z.string().optional().default('tts-1'),
  TTS_VOICE: z.string().optional().default('alloy'),
  CORS_ORIGIN: z.string().default('http://localhost:4000'),
  /** PostgreSQL connection string. When set, sessions and memory use PostgreSQL instead of JSON files. */
  DATABASE_URL: z.string().optional(),
  /** Langfuse observability — get keys from your self-hosted Langfuse instance at /settings */
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_HOST: z.string().url().optional(),
  /**
   * Phase 3 — Pre-Flight Simulation.
   *
   * `auto`   try Docker once at startup; fall back to host if unavailable
   * `docker` require Docker; pre-flight commands fail fast if missing
   * `host`   never use Docker; run pre-flight on the host shell
   */
  PREFLIGHT_MODE: z.enum(['auto', 'docker', 'host']).default('auto'),
  /** Container image used for pre-flight runs (proof verification, hypothesis re-checks). */
  PREFLIGHT_IMAGE: z.string().default('node:20-alpine'),
  /** Wall-clock cap per pre-flight command — also bounds the auto-retry loop. */
  PREFLIGHT_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  /** Max LLM-driven retries when a proof verification fails. 0 disables auto-retry. */
  PREFLIGHT_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  /**
   * Phase 5 — autonomous tech-debt scanner interval (ms). When set to a
   * positive number, a background scan runs every N ms. Default 0 = disabled;
   * users can still trigger scans manually via POST /v1/tech-debt/scan.
   */
  TECH_DEBT_SCAN_INTERVAL_MS: z.coerce.number().int().min(0).default(0),
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
