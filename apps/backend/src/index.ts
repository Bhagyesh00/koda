import { createServer } from './server.js';
import { config } from './config.js';
import { logger } from './logger.js';

const app = createServer();

app.listen(config.BACKEND_PORT, () => {
  logger.info(
    {
      port: config.BACKEND_PORT,
      workDir: config.WORK_DIR_ABS,
      model: config.OLLAMA_MODEL,
      ollama: config.OLLAMA_BASE_URL,
    },
    'koda backend listening',
  );
});

process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
process.on('uncaughtException', (err) => logger.error({ err }, 'uncaughtException'));
