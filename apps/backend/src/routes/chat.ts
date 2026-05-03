import { Router } from 'express';
import { z } from 'zod';
import { SSEWriter } from '../sse.js';
import { runTurn } from '../agent/loop.js';
import { sessionStore } from '../sessions/store.js';
import { SessionModeSchema } from '@koda/shared';
import { logger } from '../logger.js';

export const chatRouter: Router = Router();

const ChatBody = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
  mode: SessionModeSchema.optional(),
  autoApproveAll: z.boolean().optional(),
  showThinking: z.boolean().optional(),
});

// SSE comment frame keeps the connection warm during long Ollama model loads
// (first inference can take 60 s+). Without it, intermediate proxies or
// browsers may close an apparently-idle response and trigger a false abort.
const KEEPALIVE_INTERVAL_MS = 20_000;

chatRouter.post('/chat', async (req, res) => {
  const body = ChatBody.parse(req.body);
  const sse = new SSEWriter(res);
  const ac = new AbortController();

  let aborted = false;
  const onClientClose = () => {
    if (sse.isClosed || aborted) return;
    aborted = true;
    logger.debug({ sessionId: body.sessionId }, 'chat client disconnected — aborting turn');
    ac.abort();
  };
  // Abort the in-flight Ollama fetch only if the client disconnects BEFORE
  // we've finished the turn. Listening on req.on('close') is wrong: that event
  // can fire during a normal response lifecycle, which killed the Ollama fetch
  // while we were still waiting on model load. res.on('close') only fires when
  // the *response* socket closes — which is what we actually want.
  res.on('close', onClientClose);

  const keepAlive = setInterval(() => {
    if (sse.isClosed) {
      clearInterval(keepAlive);
      return;
    }
    try {
      res.write(': ping\n\n');
    } catch {
      // Socket gone — let res.on('close') handle the abort.
      clearInterval(keepAlive);
    }
  }, KEEPALIVE_INTERVAL_MS);

  // Apply requested mode override before the turn starts and let the client confirm.
  if (body.mode) {
    const updated = sessionStore.setMode(body.sessionId, body.mode);
    if (updated) {
      sse.send({ type: 'mode_change', mode: updated.mode });
    }
  }

  try {
    await runTurn({
      sessionId: body.sessionId,
      userMessage: body.message,
      sse,
      signal: ac.signal,
      autoApproveAll: body.autoApproveAll,
      showThinking: body.showThinking,
    });
  } catch (err) {
    if (!sse.isClosed) {
      sse.send({
        type: 'error',
        code: 'turn_error',
        message: err instanceof Error ? err.message : String(err),
      });
      sse.send({ type: 'done' });
      sse.close();
    }
  } finally {
    clearInterval(keepAlive);
  }
});
