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
import { guardrailsRouter } from './routes/guardrails.js';
import { watchRouter } from './routes/watch.js';
import { customToolsRouter } from './routes/customTools.js';
import { snapshotsRouter } from './routes/snapshots.js';
import { peerReviewRouter } from './routes/peerReview.js';
import { fsRouter } from './routes/fs.js';
import { usageRouter } from './routes/usage.js';
import { uploadRouter } from './routes/upload.js';
import { webhookRouter } from './routes/webhook.js';
import { schedulesRouter } from './routes/schedules.js';
import { authRouter } from './routes/auth.js';
import { ttsRouter } from './routes/tts.js';
import { registerAllTools } from './tools/index.js';
import { loadCustomTools } from './tools/customLoader.js';

export function createServer(): express.Express {
  registerAllTools();
  loadCustomTools(config.WORK_DIR_ABS);

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

  // Public auth routes (register/login must be before requireAuth middleware)
  app.use('/v1', authRouter);

  // Authenticated API
  app.use('/v1', requireAuth, sessionsRouter);
  app.use('/v1', requireAuth, chatRouter);
  app.use('/v1', requireAuth, approvalRouter);
  app.use('/v1', requireAuth, plansRouter);
  app.use('/v1', requireAuth, guardrailsRouter);
  app.use('/v1', requireAuth, watchRouter);
  app.use('/v1', requireAuth, customToolsRouter);
  app.use('/v1', requireAuth, snapshotsRouter);
  app.use('/v1', requireAuth, peerReviewRouter);
  app.use('/v1', requireAuth, fsRouter);
  app.use('/v1', requireAuth, usageRouter);
  app.use('/v1', requireAuth, uploadRouter);
  app.use('/v1', requireAuth, webhookRouter);
  app.use('/v1', requireAuth, schedulesRouter);
  app.use('/v1', requireAuth, ttsRouter);

  app.use(errorHandler);

  return app;
}
