import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler } from './middleware/error.js';
import { requireAuth } from './middleware/auth.js';
import { healthRouter } from './routes/health.js';
import { sessionsRouter } from './routes/sessions.js';
import { chatRouter } from './routes/chat.js';
import { approvalRouter } from './routes/approval.js';
import { plansRouter } from './routes/plans.js';
import { registerAllTools } from './tools/index.js';

export function createServer(): express.Express {
  registerAllTools();

  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: config.CORS_ORIGIN,
      credentials: false,
    }),
  );
  app.use(express.json({ limit: '2mb' }));

  // Public health
  app.use('/v1', healthRouter);

  // Authenticated API
  app.use('/v1', requireAuth, sessionsRouter);
  app.use('/v1', requireAuth, chatRouter);
  app.use('/v1', requireAuth, approvalRouter);
  app.use('/v1', requireAuth, plansRouter);

  app.use(errorHandler);

  return app;
}
