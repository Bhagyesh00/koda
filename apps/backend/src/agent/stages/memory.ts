import { memoryStore } from '../../memory/store.js';
import { sessionStore } from '../../sessions/store.js';
import type { SSEWriter } from '../../sse.js';

/**
 * Phase 29 — Memory recall.
 * Fires at turn-start: looks up similar exchanges from other sessions and
 * emits a memory_recall event if any are found.
 */
export function recallMemory(
  sessionId: string,
  userMessage: string,
  sse: SSEWriter,
): void {
  const recalls = memoryStore.recall(userMessage, sessionId, 3);
  if (recalls.length > 0) {
    sse.send({ type: 'memory_recall', matches: recalls });
  }
}

/**
 * Phase 29 — Memory persist.
 * Fires at turn-end: saves the final assistant message paired with the user
 * message so future turns can recall similar exchanges via Jaccard similarity.
 */
export function persistMemory(sessionId: string, userMessage: string): void {
  const session = sessionStore.get(sessionId);
  if (!session) return;
  const lastAssistant = [...session.messages]
    .reverse()
    .find((m) => m.role === 'assistant');
  if (lastAssistant?.content.trim()) {
    memoryStore.remember(sessionId, userMessage, lastAssistant.content);
  }
}
