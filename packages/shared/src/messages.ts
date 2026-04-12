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
});
export type Session = z.infer<typeof SessionSchema>;
