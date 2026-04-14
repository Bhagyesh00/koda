import { nanoid } from 'nanoid';
import { sessionStore } from '../../sessions/store.js';
import { evaluateGuardrails } from '../../guardrails/engine.js';
import { jaccardSimilarity, summarizeAction, DRIFT_THRESHOLD } from '../drift.js';
import { computeBlastRadius } from '../blastRadius.js';
import type { ToolCallCtx } from './types.js';

/**
 * Phase 23 — Drift check.
 * Emits drift_warning when the about-to-run action diverges from the session's
 * pinned intent (Jaccard similarity below threshold).
 */
export function runDriftCheck(ctx: ToolCallCtx): void {
  const { sessionId, tool, parsedArgs, sse } = ctx;
  const session = sessionStore.get(sessionId);
  if (!session?.pinnedIntent) return;
  const actionSummary = summarizeAction(tool.name, parsedArgs);
  const similarity = jaccardSimilarity(session.pinnedIntent, actionSummary);
  if (similarity < DRIFT_THRESHOLD) {
    sse.send({
      type: 'drift_warning',
      similarity,
      intent: session.pinnedIntent,
      action: actionSummary.slice(0, 200),
    });
  }
}

/**
 * Guardrails check.
 * Returns 'block' if the tool call is blocked (result already emitted to SSE
 * and session), 'warn' if a warning was emitted but execution may proceed, or
 * 'pass' if no rules matched.
 */
export function runGuardrailsCheck(ctx: ToolCallCtx): 'block' | 'warn' | 'pass' {
  const { sessionId, callId, tool, parsedArgs, sse } = ctx;
  const session = sessionStore.get(sessionId);
  const result = evaluateGuardrails(session?.guardrails ?? [], tool.name, parsedArgs);
  if (!result.triggered || !result.rule) return 'pass';

  const rule = result.rule;
  sse.send({
    type: 'guardrail_triggered',
    ruleId: rule.id,
    action: rule.action,
    message: rule.message,
    tool: tool.name,
  });

  if (rule.action === 'block') {
    const msg = `Guardrail blocked: ${rule.message}`;
    sessionStore.appendMessage(sessionId, {
      id: nanoid(8),
      role: 'tool',
      content: msg,
      toolCallId: callId,
      createdAt: Date.now(),
    });
    sse.send({ type: 'tool_result', callId, ok: false, output: msg });
    return 'block';
  }

  // 'warn' — event emitted, execution proceeds
  return 'warn';
}

/** Emits the tool_request event so the frontend can render an approval card. */
export function emitToolRequest(ctx: ToolCallCtx): void {
  const { callId, tool, parsedArgs, sse } = ctx;
  sse.send({
    type: 'tool_request',
    callId,
    tool: tool.name,
    args: parsedArgs,
    requiresApproval: tool.requiresApproval,
  });
}

/**
 * Phase 21 — Blast radius.
 * Computes import/reference reach for write_file and edit_file targets and
 * emits blast_radius. Errors are silently ignored (best-effort analysis).
 */
export function computeAndEmitBlastRadius(ctx: ToolCallCtx): void {
  const { workDir, tool, parsedArgs, callId, sse } = ctx;
  if (tool.name !== 'write_file' && tool.name !== 'edit_file') return;
  const targetPath = (parsedArgs as { path?: string }).path;
  if (!targetPath) return;
  try {
    const radius = computeBlastRadius(workDir, targetPath);
    if (radius.importers.length > 0 || radius.references > 0) {
      sse.send({
        type: 'blast_radius',
        callId,
        importers: radius.importers,
        references: radius.references,
        tests: radius.tests,
      });
    }
  } catch {
    /* best-effort: ignore scan errors */
  }
}
