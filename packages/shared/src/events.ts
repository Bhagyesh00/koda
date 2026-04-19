import type { Todo, SessionMode } from './messages.js';

export type ServerEvent =
  | { type: 'message_start'; messageId: string }
  | { type: 'delta'; messageId: string; text: string }
  | { type: 'thinking'; messageId: string; text: string }
  | { type: 'activity_update'; phase: 'thinking' | 'reading' | 'writing' | 'running' | 'idle'; tool?: string; detail?: string }
  | { type: 'tool_request'; callId: string; tool: string; args: unknown; requiresApproval: boolean }
  | { type: 'tool_result'; callId: string; ok: boolean; output: string }
  | { type: 'todo_update'; todos: Todo[] }
  | { type: 'plan_update'; content: string }
  | { type: 'mode_change'; mode: SessionMode }
  | { type: 'message_end'; messageId: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'guardrail_triggered'; ruleId: string; action: 'block' | 'warn'; message: string; tool: string }
  | { type: 'context_update'; files: string[] }
  | { type: 'hypothesis_update'; id: string; result: 'confirmed' | 'refuted' | 'pending'; actualOutcome?: string }
  | { type: 'snapshot_created'; ref: string; description: string; ts: number }
  | { type: 'workspace_change'; files: string[]; changeType: 'modified' | 'added' | 'deleted' }
  | { type: 'decision_request'; callId: string; question: string; options: Array<{ label: string; pros: string[]; cons: string[] }> }
  | { type: 'subagent_update'; agentId: string; status: 'running' | 'done' | 'error'; result?: string }
  // Phase 28 — cost meter
  | { type: 'cost_update'; turnTokens: number; sessionTokens: number; elapsedMs: number; budget?: number }
  // Phase 23 — intent drift
  | { type: 'drift_warning'; similarity: number; intent: string; action: string }
  // Phase 26 — regret journal
  | { type: 'regret_detected'; path: string; editCount: number; timespanMs: number }
  // Phase 25 — semantic diff
  | { type: 'semantic_diff'; path: string; summary: string; added: number; removed: number; changed: number }
  // Phase 21 — blast radius
  | { type: 'blast_radius'; callId: string; importers: string[]; references: number; tests: string[] }
  // Phase 24 — proof-carrying changes
  | { type: 'proof_result'; callId: string; passed: boolean; output: string }
  // Phase 30 — mental model
  | { type: 'mental_model_update'; nodes: Array<{ id: string; kind: 'file' | 'symbol' | 'concept'; label: string; weight: number }>; edges: Array<{ from: string; to: string; kind: 'imports' | 'references' | 'co-accessed' }> }
  // Phase 29 — memory recall
  | { type: 'memory_recall'; matches: Array<{ sessionId: string; excerpt: string; score: number; ts: number }> }
  // Structured test results (parsed from bash output)
  | {
      type: 'test_results';
      callId: string;
      runner: string;
      passed: number;
      failed: number;
      skipped: number;
      duration?: string;
      failures: Array<{ name: string; message: string }>;
    }
  | { type: 'turn_cancelled'; sessionId: string }
  // Self-correction loop
  | { type: 'self_correction'; messageId: string; original: string; corrected: string }
  // Verifiable reasoning proof
  | { type: 'reasoning_proof'; messageId: string; hash: string; signature: string; ts: number }
  // Phase 31 — market-gap features
  | { type: 'constraint_added'; id: string; constraintType: string; text: string }
  | { type: 'checkpoint_saved'; id: string; summary: string; messageIndex: number; ts: number }
  | { type: 'rejection_recorded'; context: string; rejected: string; ts: number }
  | { type: 'refactor_tx_update'; action: string; goal?: string; filesDone: number; filesPlanned: number }
  | { type: 'deploy_gate_result'; passed: boolean; failures: Array<{ gate: string; message: string }> }
  | { type: 'import_verify_result'; path: string; unresolved: string[] }
  | { type: 'perf_check_result'; command: string; meanMs: number; p99Ms: number; budgetOk: boolean }
  | { type: 'pr_review_result'; files: number; confidence: number; risks: string[] }
  | { type: 'done' };

export type ApprovalDecision =
  | { action: 'approve'; args?: unknown }
  | { action: 'deny'; reason?: string };
