import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { sessionStore } from '../../sessions/store.js';
import { evaluateGuardrails, evaluateRiskTier } from '../../guardrails/engine.js';
import { evaluateArchitecture } from '../../guardrails/architecture.js';
import { jaccardSimilarity, summarizeAction, DRIFT_THRESHOLD } from '../drift.js';
import { computeBlastRadius } from '../blastRadius.js';
import type { ToolCallCtx } from './types.js';

const TIER_FORCES_APPROVAL = new Set(['high', 'critical']);

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
  // evaluateGuardrails filters to action ∈ {block, warn}; the `tier` action is
  // never returned here. Narrow explicitly so the SSE event type stays clean.
  const ruleAction: 'block' | 'warn' = rule.action === 'block' ? 'block' : 'warn';
  sse.send({
    type: 'guardrail_triggered',
    ruleId: rule.id,
    action: ruleAction,
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
  const { callId, tool, parsedArgs, sse, riskTier, forceApproval } = ctx;
  sse.send({
    type: 'tool_request',
    callId,
    tool: tool.name,
    args: parsedArgs,
    requiresApproval: tool.requiresApproval,
    ...(riskTier ? { riskTier } : {}),
    ...(forceApproval ? { forceApproval: true } : {}),
  });
}

/**
 * Phase 2 — Risk-tier evaluation (Action Governance).
 *
 * Attaches a riskTier to the call context and sets `forceApproval` for high/
 * critical tiers. The agent loop reads `forceApproval` to decide whether to
 * gate a tool that would otherwise bypass approval (expert mode, autoAccept).
 */
export function runRiskTier(ctx: ToolCallCtx): void {
  const { sessionId, tool, parsedArgs } = ctx;
  const session = sessionStore.get(sessionId);
  const match = evaluateRiskTier(session?.guardrails ?? [], tool.name, parsedArgs);
  if (!match) return;
  ctx.riskTier = match.tier;
  if (TIER_FORCES_APPROVAL.has(match.tier)) {
    ctx.forceApproval = true;
  }
}

/**
 * Phase 2 — Architectural Linter.
 *
 * Only fires for write_file / edit_file on code files. For write_file the
 * candidate content is `args.content`; for edit_file we read the current file
 * and apply the regex-style replacement the tool would perform, so violations
 * introduced by an in-place edit are also caught.
 *
 * Returns 'block' (and emits a guardrail event + tool_result) when a violating
 * import would land in a `block`-action architecture rule. Warn-action
 * violations emit the event but allow execution to proceed.
 */
export function runArchitectureCheck(ctx: ToolCallCtx): 'block' | 'warn' | 'pass' {
  const { sessionId, workDir, callId, tool, parsedArgs, sse } = ctx;
  if (tool.name !== 'write_file' && tool.name !== 'edit_file') return 'pass';
  const session = sessionStore.get(sessionId);
  const rules = session?.guardrails ?? [];
  if (rules.length === 0) return 'pass';

  const args = parsedArgs as { path?: string; content?: string; oldString?: string; newString?: string };
  const targetPath = args.path;
  if (!targetPath) return 'pass';

  let candidateContent: string | null = null;
  if (tool.name === 'write_file') {
    candidateContent = typeof args.content === 'string' ? args.content : null;
  } else {
    // edit_file: synthesize the post-edit content. Best-effort — falls back
    // to skipping the check rather than blocking on a parse failure.
    try {
      const abs = path.isAbsolute(targetPath) ? targetPath : path.join(workDir, targetPath);
      if (fs.existsSync(abs)) {
        const current = fs.readFileSync(abs, 'utf8');
        if (typeof args.oldString === 'string' && typeof args.newString === 'string') {
          candidateContent = current.split(args.oldString).join(args.newString);
        }
      }
    } catch {
      candidateContent = null;
    }
  }
  if (candidateContent == null) return 'pass';

  const violations = evaluateArchitecture(rules, workDir, targetPath, candidateContent);
  if (violations.length === 0) return 'pass';

  // Block beats warn — match the pattern engine's precedence semantics.
  const blocker = violations.find((v) => v.action === 'block');
  const chosen = blocker ?? violations[0]!;
  const summary =
    `Architecture rule "${chosen.ruleDescription}" — ` +
    `${chosen.fromLayer} → ${chosen.toLayer} (import "${chosen.importStatement}")`;

  sse.send({
    type: 'guardrail_triggered',
    ruleId: chosen.ruleId,
    action: chosen.action,
    message: summary,
    tool: tool.name,
  });

  if (chosen.action === 'block') {
    const msg = `Architecture violation blocked: ${summary}`;
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
  return 'warn';
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
