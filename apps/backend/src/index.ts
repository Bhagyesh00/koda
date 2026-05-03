import { createServer } from './server.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { initPool } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { sessionStore } from './sessions/store.js';
import { initLangfuse } from './telemetry/langfuse.js';
import { initRedis } from './cache/redis.js';
import { loadSchedules } from './routes/schedules.js';
import { techDebtStore } from './techDebt/store.js';
import { startAutoScanLoop } from './routes/techDebt.js';

async function main() {
  await initPool();
  await runMigrations();
  await sessionStore.initialize();
  await techDebtStore.initialize();
  initLangfuse();
  await initRedis();
  await loadSchedules();
  startAutoScanLoop();

  const app = createServer();
  app.listen(config.BACKEND_PORT, () => {
    logger.info(
      {
        port: config.BACKEND_PORT,
        workDir: config.WORK_DIR_ABS,
        model: config.OLLAMA_MODEL,
        ollama: config.OLLAMA_BASE_URL,
        db: config.DATABASE_URL ? 'postgres' : 'files',
      },
      'koda backend listening',
    );
  });
}

main();

process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
process.on('uncaughtException', (err) => logger.error({ err }, 'uncaughtException'));
