import type { SSEWriter } from '../../sse.js';

/**
 * Mutable state shared across all tool calls within a single LLM turn.
 * Stages read and write this to coordinate cross-call behaviour (e.g. hypothesis
 * recorded on one call, verified on the next bash call).
 */
export interface TurnState {
  pendingHypothesis: { id: string; verification: string } | null;
  pendingProof: { description: string; command: string } | null;
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
}

/** Canonical keys for ToolCallCtx.stageState entries. */
export const STAGE_KEYS = {
  /** SemanticDiff stage stashes { before: string, targetPath: string } here. */
  SEMANTIC_DIFF_BEFORE: 'semanticDiff.before',
} as const;
