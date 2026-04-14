import { Router } from 'express';
import { z } from 'zod';
import { SSEWriter } from '../sse.js';
import { runTurn } from '../agent/loop.js';
import { sessionStore } from '../sessions/store.js';
import { SessionModeSchema } from '@koda/shared';

export const chatRouter: Router = Router();

const ChatBody = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
  mode: SessionModeSchema.optional(),
  autoApproveAll: z.boolean().optional(),
  showThinking: z.boolean().optional(),
});

chatRouter.post('/chat', async (req, res) => {
  const body = ChatBody.parse(req.body);
  const sse = new SSEWriter(res);
  const ac = new AbortController();
  // Abort the in-flight Ollama fetch only if the client disconnects BEFORE
  // we've finished the turn. Listening on req.on('close') was wrong: that
  // event can fire during a normal response lifecycle, which killed the
  // Ollama fetch while we were still waiting on model load.
  res.on('close', () => {
    if (!sse.isClosed) ac.abort();
  });

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
  }
});
