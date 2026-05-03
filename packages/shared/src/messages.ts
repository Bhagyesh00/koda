import { z } from 'zod';

export const RoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export type Role = z.infer<typeof RoleSchema>;

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.unknown(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolResultSchema = z.object({
  callId: z.string(),
  ok: z.boolean(),
  output: z.string(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: RoleSchema,
  content: z.string(),
  /** Extracted <think>...</think> content for assistant messages. Stored so
   *  the ThinkingBlock can be reconstructed when the session is reloaded. */
  thinking: z.string().optional(),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolCallId: z.string().optional(),
  createdAt: z.number(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const TodoSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']),
});
export type Todo = z.infer<typeof TodoSchema>;

export const SessionModeSchema = z.enum(['plan', 'build', 'expert']);
export type SessionMode = z.infer<typeof SessionModeSchema>;

/** `tier` is for risk-tier rules — see RiskTier below. Pattern/architecture rules use block/warn. */
export const GuardActionSchema = z.enum(['block', 'warn', 'tier']);
export type GuardAction = z.infer<typeof GuardActionSchema>;

export const RiskTierSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type RiskTier = z.infer<typeof RiskTierSchema>;

/**
 * Architecture rule payload. Layers are named globs; edges declare which layers
 * may import which other layers. An edit that introduces an import violating an
 * edge is blocked (or warned) the same way a pattern rule fires.
 *
 *   layers: { core: ['src/core/**'], api: ['src/api/**'] }
 *   edges:  [{ from: 'api', to: 'core' }]   // api may import core; reverse is blocked
 */
export const ArchitectureRuleSchema = z.object({
  layers: z.record(z.string(), z.array(z.string()).min(1)),
  edges: z.array(z.object({ from: z.string(), to: z.string() })),
});
export type ArchitectureRule = z.infer<typeof ArchitectureRuleSchema>;

export const GuardRuleSchema = z.object({
  id: z.string(),
  enabled: z.boolean().default(true),
  description: z.string().min(1),
  /**
   * Rule discriminator. Optional so existing stored rules (without `kind`) and
   * frontend presets keep working without explicit migration; the engine
   * normalises `undefined` to `'pattern'` at evaluation time.
   */
  kind: z.enum(['pattern', 'architecture', 'risk_tier']).optional(),
  /** Tool names this rule applies to. Use ['*'] for all tools. */
  tools: z.array(z.string()).default(['*']),
  /** Glob pattern matched against args.path (file tools). Empty = any path. */
  pathPattern: z.string().optional(),
  /** Regex matched against args.command (bash tool). Empty = any command. */
  commandPattern: z.string().optional(),
  action: GuardActionSchema,
  message: z.string().min(1),
  /** Architecture-rule payload — only meaningful when kind === 'architecture'. */
  architecture: ArchitectureRuleSchema.optional(),
  /**
   * Risk-tier classification — only meaningful when kind === 'risk_tier'.
   * When a tool call matches a risk_tier rule, the engine forces the approval
   * gate even in expert mode / autoApproveAll for high or critical tiers.
   */
  riskTier: RiskTierSchema.optional(),
});
export type GuardRule = z.infer<typeof GuardRuleSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  messages: z.array(ChatMessageSchema),
  todos: z.array(TodoSchema),
  mode: SessionModeSchema.default('build'),
  planPath: z.string().optional(),
  /** Absolute path the session is rooted at. Falls back to the server's WORK_DIR when unset. */
  cwd: z.string().optional(),
  guardrails: z.array(GuardRuleSchema).default([]),
  /** Files/symbols the agent has read this session (for Context Lens). */
  contextReads: z.array(z.string()).default([]),
  /** Hypotheses recorded this session. */
  hypotheses: z.array(z.object({
    id: z.string(),
    claim: z.string(),
    verification: z.string(),
    expectedOutcome: z.string(),
    actualOutcome: z.string().optional(),
    result: z.enum(['confirmed', 'refuted', 'pending']).default('pending'),
    ts: z.number(),
    /** Decision-Ledger rationale: why was this hypothesis recorded? */
    reason: z.string().optional(),
  })).default([]),
  /** Snapshots (git stashes) taken this session. */
  snapshots: z.array(z.object({
    ref: z.string(),
    description: z.string(),
    ts: z.number(),
  })).default([]),
  /** Branch metadata (if this is a branch of another session). */
  parentId: z.string().optional(),
  branchPoint: z.number().optional(),
  /** Pinned user intent (Phase 23). */
  pinnedIntent: z.string().optional(),
  /** Token budget cap for the session — null means no cap (Phase 28). */
  tokenBudget: z.number().optional(),
  /** Cumulative tokens used so far in this session (Phase 28). */
  tokensUsed: z.number().default(0),
  /** File edit history for Regret Journal (Phase 26). */
  editHistory: z.array(z.object({
    path: z.string(),
    ts: z.number(),
    contentHash: z.string(),
    reverted: z.boolean().default(false),
  })).default([]),
  /**
   * Ollama model override for this session.
   * When set, overrides the server's OLLAMA_MODEL env var for all turns in this session.
   */
  model: z.string().optional(),
  /** Active skill slug (persona). */
  skill: z.string().optional(),
  /** Verifiable reasoning proofs — one per completed turn. */
  proofs: z.array(z.object({
    messageId: z.string(),
    hash: z.string(),
    signature: z.string(),
    ts: z.number(),
    /** Decision-Ledger rationale: why was this proof recorded? */
    reason: z.string().optional(),
  })).default([]),
  /** Persistent constraints injected into every system prompt (Phase 31). */
  constraints: z.array(z.object({
    id: z.string(),
    type: z.enum(['functional', 'non-functional', 'security', 'architecture', 'domain', 'performance']),
    text: z.string(),
    createdAt: z.number(),
  })).default([]),
  /** Checkpoints — snapshots of agent state for long-running task resumption (Phase 31). */
  checkpoints: z.array(z.object({
    id: z.string(),
    ts: z.number(),
    messageIndex: z.number(),
    summary: z.string(),
    toolCallsSoFar: z.number(),
    /** Decision-Ledger rationale: why was this checkpoint taken? */
    reason: z.string().optional(),
  })).default([]),
  /** User rejections — patterns the user has undone/rejected (Phase 31). */
  rejections: z.array(z.object({
    ts: z.number(),
    context: z.string(),
    rejected: z.string(),
    /** Decision-Ledger rationale: why was this rejection recorded? */
    reason: z.string().optional(),
  })).default([]),
  /** Performance budget for generated code (Phase 31). */
  performanceBudget: z.object({
    p99LatencyMs: z.number().optional(),
    maxMemoryMb: z.number().optional(),
    maxIoOpsPerRequest: z.number().optional(),
  }).optional(),
  /** Refactor transactions — multi-file edit tracking (Phase 31). */
  refactorTx: z.object({
    id: z.string(),
    goal: z.string(),
    filesPlanned: z.array(z.string()),
    filesDone: z.array(z.string()),
    startedAt: z.number(),
  }).optional(),
  /** Mental model graph nodes (Phase 30). */
  mentalModel: z.object({
    nodes: z.array(z.object({
      id: z.string(),
      kind: z.enum(['file', 'symbol', 'concept']),
      label: z.string(),
      weight: z.number().default(1),
    })).default([]),
    edges: z.array(z.object({
      from: z.string(),
      to: z.string(),
      kind: z.enum(['imports', 'references', 'co-accessed']).default('co-accessed'),
    })).default([]),
  }).default({ nodes: [], edges: [] }),
});
export type Session = z.infer<typeof SessionSchema>;
