import { memoryStore } from '../../memory/store.js';
import { sessionStore } from '../../sessions/store.js';
import type { SSEWriter } from '../../sse.js';

export type RecallMatch = { sessionId: string; excerpt: string; score: number; ts: number };

export async function recallMemory(
  sessionId: string,
  userMessage: string,
  sse: SSEWriter,
): Promise<RecallMatch[]> {
  const recalls = await memoryStore.recall(userMessage, sessionId, 3);
  if (recalls.length > 0) {
    sse.send({ type: 'memory_recall', matches: recalls });
  }
  return recalls;
}

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
