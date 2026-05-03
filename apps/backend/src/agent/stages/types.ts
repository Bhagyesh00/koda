import type { SSEWriter } from '../../sse.js';
import type { RiskTier } from '@koda/shared';

/**
 * Mutable state shared across all tool calls within a single LLM turn.
 * Stages read and write this to coordinate cross-call behaviour (e.g. hypothesis
 * recorded on one call, verified on the next bash call).
 */
export interface TurnState {
  pendingHypothesis: { id: string; verification: string } | null;
  pendingProof: { description: string; command: string } | null;
  /** Tracks retry attempts per tool name for error auto-resolution. */
  retryTracker: Map<string, number>;
  /**
   * Phase 3 — Pre-Flight Simulation auto-retry counter, keyed by proof command.
   * Increments each time `runProofVerify` fires the LLM-fix loop for the same
   * verification command; capped at `config.PREFLIGHT_MAX_RETRIES`.
   */
  proofRetries: Map<string, number>;
  /**
   * Phase 3 — system-message hints queued by post-execution stages. Drained at
   * the start of each loop iteration and pushed into the Ollama message array
   * so the model gets the failure context before its next response.
   */
  pendingHints: string[];
}

/** Minimal tool descriptor needed by stage functions. */
export interface ToolRef {
  name: string;
  requiresApproval: boolean;
}

/**
 * Context object threaded through every stage function for a single tool call.
 *
 * Populated incrementally — some fields are only valid at certain points:
 *  - `parsedArgs`  set immediately after Zod parse, before any stage
 *  - `finalArgs`   set after the approval gate (may differ if user edited args)
 *  - `output`/`ok` set after tool execution
 */
export interface ToolCallCtx {
  sessionId: string;
  workDir: string;
  sse: SSEWriter;
  signal?: AbortSignal;
  callId: string;
  tool: ToolRef;
  /** Zod-validated input to the tool. Available for all stages. */
  parsedArgs: unknown;
  /** Final args sent to tool.run(). Set after the approval gate. */
  finalArgs: unknown;
  /** Raw tool output string. Set after execution. */
  output: string;
  /** Whether tool.run() succeeded. Set after execution. */
  ok: boolean;
  /** Mutable turn-level state shared across all tool calls in this turn. */
  turn: TurnState;
  /**
   * Per-call scratch space for stages that need to pass data between their
   * pre-execution and post-execution hooks. Use STAGE_KEYS as key names.
   */
  stageState: Map<string, unknown>;
  /**
   * Phase 2 — Action Governance. Set by `runRiskTier` when a risk_tier rule
   * matches the call. The agent loop checks `forceApproval` to decide whether
   * to gate a tool that would normally bypass approval (expert mode or
   * autoApproveAll); `riskTier` rides on the `tool_request` SSE event so the
   * UI can render an escalation badge.
   */
  riskTier?: RiskTier;
  forceApproval?: boolean;
}

/** Canonical keys for ToolCallCtx.stageState entries. */
export const STAGE_KEYS = {
  /** SemanticDiff stage stashes { before: string, targetPath: string } here. */
  SEMANTIC_DIFF_BEFORE: 'semanticDiff.before',
} as const;
