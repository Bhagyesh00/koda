import { Router, Request, Response } from 'express';
import type { ServerEvent } from '@koda/shared';
import { sessionStore } from '../sessions/store.js';
import { runTurn } from '../agent/loop.js';
import { SSEWriter } from '../sse.js';
import { logger } from '../logger.js';

export const webhookRouter: Router = Router();

/** Minimal SSEWriter-compatible class that collects text output into a buffer. */
class BufferSSE extends SSEWriter {
  readonly parts: string[] = [];

  constructor() {
    // Pass a fake response that discards all writes
    const fakeRes = {
      setHeader: () => {},
      write: () => true,
      end: () => {},
      flushHeaders: () => {},
    } as never;
    super(fakeRes);
  }

  override send(event: ServerEvent): void {
    if (event.type === 'delta' && 'text' in event) {
      this.parts.push(event.text as string);
    }
  }

  override close(): void {}

  get text(): string {
    return this.parts.join('');
  }
}

/**
 * POST /v1/webhook/run
 *
 * Trigger an agent run from CI/CD or external systems.
 * Body: { message, sessionId?, workDir?, timeoutMs? }
 * Returns: { sessionId, status, response }
 */
webhookRouter.post('/webhook/run', async (req: Request, res: Response) => {
  const {
    message,
    sessionId: existingId,
    workDir,
    timeoutMs = 120_000,
  } = req.body as {
    message?: string;
    sessionId?: string;
    workDir?: string;
    timeoutMs?: number;
  };

  if (!message) {
    res.status(400).json({ error: '`message` is required' });
    return;
  }

  let sessionId = existingId;
  if (sessionId) {
    if (!sessionStore.get(sessionId)) {
      res.status(404).json({ error: `Session ${sessionId} not found` });
      return;
    }
  } else {
    const session = sessionStore.create({ title: `Webhook: ${message.slice(0, 60)}`, cwd: workDir });
    sessionId = session.id;
  }

  logger.info({ sessionId, message: message.slice(0, 100) }, 'webhook run triggered');

  const sse = new BufferSSE();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    await runTurn({ sessionId, userMessage: message, sse, signal: ac.signal, autoApproveAll: true });
    clearTimeout(timer);
    res.json({ sessionId, status: 'completed', response: sse.text });
  } catch (err) {
    clearTimeout(timer);
    logger.error({ err, sessionId }, 'webhook run error');
    res.status(500).json({ sessionId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
});
