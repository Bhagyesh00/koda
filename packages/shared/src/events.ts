import type { Todo, SessionMode } from './messages.js';

export type ServerEvent =
  | { type: 'message_start'; messageId: string }
  | { type: 'delta'; messageId: string; text: string }
  | { type: 'tool_request'; callId: string; tool: string; args: unknown; requiresApproval: boolean }
  | { type: 'tool_result'; callId: string; ok: boolean; output: string }
  | { type: 'todo_update'; todos: Todo[] }
  | { type: 'plan_update'; content: string }
  | { type: 'mode_change'; mode: SessionMode }
  | { type: 'message_end'; messageId: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'done' };

export type ApprovalDecision =
  | { action: 'approve'; args?: unknown }
  | { action: 'deny'; reason?: string };
