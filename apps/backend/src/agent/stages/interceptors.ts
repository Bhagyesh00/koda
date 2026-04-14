import { nanoid } from 'nanoid';
import { sessionStore } from '../../sessions/store.js';
import { approvalQueue } from '../../approval/queue.js';
import type { ToolCallCtx } from './types.js';

/**
 * Intercept tools that are handled entirely by the framework before any
 * approval gate or tool execution.  Returns true if the tool was handled
 * (loop should `continue`), false otherwise.
 *
 * Covers: hypothesis (Phase 19), proof (Phase 24), decide (Phase 14).
 * These tools produce structured framework state rather than workspace
 * side-effects, so they short-circuit the normal execution pipeline.
 */
export async function runInterceptors(ctx: ToolCallCtx): Promise<boolean> {
  const { sessionId, callId, parsedArgs, tool, sse, turn } = ctx;

  // ── hypothesis ─────────────────────────────────────────────────────────
  if (tool.name === 'hypothesis') {
    const hyp = parsedArgs as {
      claim: string;
      verification: string;
      expectedOutcome: string;
    };
    const hypId = nanoid(8);
    sessionStore.addHypothesis(sessionId, {
      id: hypId,
      claim: hyp.claim,
      verification: hyp.verification,
      expectedOutcome: hyp.expectedOutcome,
      result: 'pending',
      ts: Date.now(),
    });
    turn.pendingHypothesis = { id: hypId, verification: hyp.verification };
    const msg = `Hypothesis recorded: "${hyp.claim}" — will verify after next bash call.`;
    sessionStore.appendMessage(sessionId, {
      id: nanoid(8),
      role: 'tool',
      content: msg,
      toolCallId: callId,
      createdAt: Date.now(),
    });
    sse.send({ type: 'tool_result', callId, ok: true, output: msg });
    return true;
  }

  // ── proof ───────────────────────────────────────────────────────────────
  if (tool.name === 'proof') {
    const proof = parsedArgs as { description: string; command: string };
    turn.pendingProof = { description: proof.description, command: proof.command };
    const msg = `Proof registered: "${proof.description}" — will run after next mutation.`;
    sessionStore.appendMessage(sessionId, {
      id: nanoid(8),
      role: 'tool',
      content: msg,
      toolCallId: callId,
      createdAt: Date.now(),
    });
    sse.send({ type: 'tool_result', callId, ok: true, output: msg });
    return true;
  }

  // ── decide ──────────────────────────────────────────────────────────────
  if (tool.name === 'decide') {
    const decision = parsedArgs as {
      question: string;
      options: Array<{ label: string; pros: string[]; cons: string[] }>;
    };
    sse.send({
      type: 'decision_request',
      callId,
      question: decision.question,
      options: decision.options,
    });
    const choice = await approvalQueue.requestDecision(callId);
    const chosen = decision.options[choice.optionIndex];
    const msg = `User chose option ${choice.optionIndex + 1}: "${chosen?.label ?? 'unknown'}"`;
    sessionStore.appendMessage(sessionId, {
      id: nanoid(8),
      role: 'tool',
      content: msg,
      toolCallId: callId,
      createdAt: Date.now(),
    });
    sse.send({ type: 'tool_result', callId, ok: true, output: msg });
    return true;
  }

  return false;
}
