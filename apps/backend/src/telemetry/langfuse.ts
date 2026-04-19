import Langfuse from 'langfuse';
import { config } from '../config.js';
import { logger } from '../logger.js';

let client: Langfuse | null = null;

export function getLangfuse(): Langfuse | null {
  return client;
}

export function initLangfuse(): void {
  if (!config.LANGFUSE_SECRET_KEY || !config.LANGFUSE_PUBLIC_KEY) return;
  client = new Langfuse({
    secretKey: config.LANGFUSE_SECRET_KEY,
    publicKey: config.LANGFUSE_PUBLIC_KEY,
    baseUrl: config.LANGFUSE_HOST ?? 'http://localhost:3001',
    flushAt: 10,
    flushInterval: 5_000,
  });
  logger.info({ host: config.LANGFUSE_HOST ?? 'http://localhost:3001' }, 'langfuse enabled');
}

export function createTrace(sessionId: string, input: string) {
  if (!client) return null;
  return client.trace({
    id: `${sessionId}-${Date.now()}`,
    name: 'agent-loop',
    sessionId,
    input,
    metadata: { model: config.OLLAMA_MODEL },
  });
}
