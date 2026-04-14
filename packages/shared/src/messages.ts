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

export const SessionModeSchema = z.enum(['plan', 'build']);
export type SessionMode = z.infer<typeof SessionModeSchema>;

export const GuardActionSchema = z.enum(['block', 'warn']);
export type GuardAction = z.infer<typeof GuardActionSchema>;

export const GuardRuleSchema = z.object({
  id: z.string(),
  enabled: z.boolean().default(true),
  description: z.string().min(1),
  /** Tool names this rule applies to. Use ['*'] for all tools. */
  tools: z.array(z.string()).default(['*']),
  /** Glob pattern matched against args.path (file tools). Empty = any path. */
  pathPattern: z.string().optional(),
  /** Regex matched against args.command (bash tool). Empty = any command. */
  commandPattern: z.string().optional(),
  action: GuardActionSchema,
  message: z.string().min(1),
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
