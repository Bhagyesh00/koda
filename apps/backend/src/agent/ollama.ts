import { config } from '../config.js';
import { logger } from '../logger.js';

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
}

export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface OllamaToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

interface OllamaStreamChunk {
  message?: {
    role: string;
    content: string;
    /**
     * Separate thinking field used by Ollama 0.9+ for models with native
     * reasoning support (gemma4, deepseek-r1, etc.).
     * When present, thinking tokens arrive here rather than in `content`.
     */
    thinking?: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
}

/**
 * Stream a chat completion from Ollama.
 *
 * Calls `onDelta` for each text token as it arrives.
 * Returns any tool_calls the model emitted (Ollama native tools API).
 *
 * If the model doesn't support native tools it falls back to text — the
 * caller can parse fence blocks from the accumulated `assistantText`.
 */
export async function streamOllamaChat(
  messages: OllamaMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  options?: {
    temperature?: number;
    seed?: number;
    tools?: OllamaToolDef[];
    /** Override the model for this request (per-session model switching). */
    model?: string;
  },
): Promise<{ toolCalls: OllamaToolCall[] }> {
  const url = `${config.OLLAMA_BASE_URL.replace(/\/$/, '')}/api/chat`;
  const model = options?.model ?? config.OLLAMA_MODEL;

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    options: {
      temperature: options?.temperature ?? 0.2,
      // Use the configured context window (default 32 768 — matches modern
      // Ollama model defaults and gives comfortable headroom for long sessions).
      num_ctx: config.OLLAMA_NUM_CTX,
      // Allow the model to use the full context window for output. A hard
      // 4096-token cap silently truncates large file writes mid-JSON, causing
      // the tool call to be unparseable and the task to stop with no error.
      num_predict: config.OLLAMA_NUM_CTX,
      // Reduce repetitive output — common with smaller coding models.
      repeat_penalty: 1.1,
      ...(options?.seed !== undefined ? { seed: options.seed } : {}),
    },
  };

  // Pass tools only when provided — models that don't support native tool calling
  // will ignore the parameter or return an Ollama-level error which we surface.
  if (options?.tools && options.tools.length > 0) {
    body.tools = options.tools;
  }

  logger.debug(
    { url, model, messageCount: messages.length, toolCount: options?.tools?.length ?? 0 },
    'ollama request',
  );

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.OLLAMA_USERNAME && config.OLLAMA_PASSWORD) {
    const token = Buffer.from(`${config.OLLAMA_USERNAME}:${config.OLLAMA_PASSWORD}`).toString('base64');
    headers['Authorization'] = `Basic ${token}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
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
  const collectedToolCalls: OllamaToolCall[] = [];
  // Track whether we've opened a <think> block that hasn't been closed yet.
  // Ollama 0.9+ streams reasoning in a separate `thinking` field; we wrap it
  // in <think>...</think> so the existing frontend streaming pipeline works
  // without any changes (partitionThinking / ThinkingBlock / LiveThinkingPreview).
  let thinkingOpen = false;

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

          // ── Thinking tokens (Ollama 0.9+ separate field) ────────────────
          if (chunk.message?.thinking) {
            if (!thinkingOpen) {
              onDelta('<think>');
              thinkingOpen = true;
            }
            onDelta(chunk.message.thinking);
          }

          // ── Regular content ──────────────────────────────────────────────
          if (chunk.message?.content) {
            // Close the think block before emitting prose so the frontend
            // parser can cleanly separate thinking from response text.
            if (thinkingOpen) {
              onDelta('</think>');
              thinkingOpen = false;
            }
            onDelta(chunk.message.content);
          }

          if (chunk.message?.tool_calls) {
            collectedToolCalls.push(...chunk.message.tool_calls);
          }

          if (chunk.done) {
            // Ensure any dangling think block is closed.
            if (thinkingOpen) {
              onDelta('</think>');
              thinkingOpen = false;
            }
            return { toolCalls: collectedToolCalls };
          }
        } catch (e) {
          logger.warn({ line: trimmed, err: e }, 'failed to parse ollama chunk');
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { toolCalls: collectedToolCalls };
}
