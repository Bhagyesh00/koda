import { config } from '../config.js';
import { logger } from '../logger.js';

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface OllamaStreamChunk {
  message?: { role: string; content: string };
  done: boolean;
}

/**
 * Stream a chat completion from Ollama. Yields raw text deltas.
 */
export async function* streamOllamaChat(
  messages: OllamaMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string, void, void> {
  const url = `${config.OLLAMA_BASE_URL.replace(/\/$/, '')}/api/chat`;
  const body = {
    model: config.OLLAMA_MODEL,
    messages,
    stream: true,
    options: {
      temperature: 0.2,
    },
  };

  logger.debug({ url, model: config.OLLAMA_MODEL, messageCount: messages.length }, 'ollama request');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const chunk = JSON.parse(trimmed) as OllamaStreamChunk;
          if (chunk.message?.content) yield chunk.message.content;
          if (chunk.done) return;
        } catch (e) {
          logger.warn({ line: trimmed, err: e }, 'failed to parse ollama chunk');
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
