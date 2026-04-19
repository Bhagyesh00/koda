import { createHmac, createHash } from 'node:crypto';
import { config } from '../../config.js';
import { sessionStore } from '../../sessions/store.js';
import type { SSEWriter } from '../../sse.js';

/**
 * Computes a verifiable proof for an LLM response turn.
 *
 * The proof is an HMAC-SHA256 over a canonical string:
 *   sessionId|messageId|timestamp|sha256(userMessage)|sha256(response)
 *
 * Anyone with the JWT_SECRET can verify the proof by recomputing the HMAC.
 * The response and userMessage hashes let third parties verify content without
 * needing the full text.
 */
export function emitReasoningProof(
  sessionId: string,
  messageId: string,
  userMessage: string,
  response: string,
  sse: SSEWriter,
): void {
  const ts = Date.now();
  const userHash = createHash('sha256').update(userMessage).digest('hex');
  const responseHash = createHash('sha256').update(response).digest('hex');

  const canonical = `${sessionId}|${messageId}|${ts}|${userHash}|${responseHash}`;
  const signature = createHmac('sha256', config.JWT_SECRET).update(canonical).digest('hex');
  const hash = createHash('sha256').update(canonical).digest('hex');

  const proof = { messageId, hash, signature, ts };
  sessionStore.addProof(sessionId, proof);
  sse.send({ type: 'reasoning_proof', messageId, hash, signature, ts });
}

/**
 * Verifies a reasoning proof given the original inputs.
 * Returns true if the signature matches.
 */
export function verifyReasoningProof(
  sessionId: string,
  messageId: string,
  ts: number,
  userMessage: string,
  response: string,
  signature: string,
): boolean {
  const userHash = createHash('sha256').update(userMessage).digest('hex');
  const responseHash = createHash('sha256').update(response).digest('hex');
  const canonical = `${sessionId}|${messageId}|${ts}|${userHash}|${responseHash}`;
  const expected = createHmac('sha256', config.JWT_SECRET).update(canonical).digest('hex');
  return expected === signature;
}
