import { logger } from '../../logger.js';
import { streamOllamaChat, type OllamaMessage } from '../ollama.js';
import type { SSEWriter } from '../../sse.js';
import { nanoid } from 'nanoid';
import { config } from '../../config.js';

const CORRECTION_PREFIX = 'CORRECTION:';
const LGTM_PATTERNS = /^(lgtm|looks good|no correction|no changes needed|the response is (correct|accurate|good|fine))/i;
const MIN_RESPONSE_LENGTH = 80;

/**
 * Runs one automatic self-critique pass after the agent's final response.
 * If the model finds a meaningful correction, updates the last assistant message
 * in the messages array and emits a self_correction SSE event.
 *
 * Returns the corrected text if a correction was applied, null otherwise.
 */
export async function runSelfCorrection(
  sessionId: string,
  messages: OllamaMessage[],
  model: string,
  sse: SSEWriter,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  // Only correct substantial final responses (skip short acks, skip if aborted)
  if (signal?.aborted) return null;
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!lastAssistant || lastAssistant.content.length < MIN_RESPONSE_LENGTH) return null;

  const originalText = lastAssistant.content;
  const messageId = nanoid(8);

  const critiqueMessages: OllamaMessage[] = [
    ...messages,
    {
      role: 'user',
      content:
        'Review your previous response critically. ' +
        'If it contains errors, incomplete reasoning, wrong code, or could be significantly improved, ' +
        `respond with "${CORRECTION_PREFIX}" on the first line followed by the fully corrected response. ` +
        'If the response is accurate and complete, respond with exactly "LGTM" and nothing else. ' +
        'Do not add commentary — either correct it or say LGTM.',
    },
  ];

  logger.debug({ sessionId, chars: originalText.length }, 'self-correction pass');

  let correctedText = '';
  try {
    await streamOllamaChat(
      critiqueMessages,
      (delta) => { correctedText += delta; },
      signal,
      { model, temperature: 0 },
    );
  } catch {
    return null;
  }

  correctedText = correctedText.trim();
  if (!correctedText || LGTM_PATTERNS.test(correctedText)) return null;
  if (!correctedText.startsWith(CORRECTION_PREFIX)) return null;

  const corrected = correctedText.slice(CORRECTION_PREFIX.length).trim();
  if (!corrected || corrected === originalText) return null;

  // Update the last assistant message in the messages array in-place
  const idx = messages.map((m, i) => ({ m, i })).reverse().find(({ m }) => m.role === 'assistant')?.i;
  if (idx !== undefined) messages[idx]!.content = corrected;

  sse.send({ type: 'self_correction', messageId, original: originalText, corrected });
  logger.info({ sessionId, originalLen: originalText.length, correctedLen: corrected.length }, 'self-correction applied');
  return corrected;
}
