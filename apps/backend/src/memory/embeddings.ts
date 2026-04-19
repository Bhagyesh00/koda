import { config } from '../config.js';
import { logger } from '../logger.js';
import { ollamaHeaders } from '../agent/ollama.js';

const EMBED_MODEL = 'nomic-embed-text';

export async function embed(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${config.OLLAMA_BASE_URL}/api/embeddings`, {
      method: 'POST',
      headers: ollamaHeaders(),
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'embed request failed');
      return null;
    }
    const data = (await res.json()) as { embedding?: number[] };
    return data.embedding ?? null;
  } catch (err) {
    logger.warn({ err }, 'embed failed');
    return null;
  }
}
