import { nanoid } from 'nanoid';
import { CheckpointSaveArgs, CheckpointListArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { sessionStore } from '../sessions/store.js';

export const checkpointSaveTool: Tool<typeof CheckpointSaveArgs._type> = {
  name: 'checkpoint_save',
  description: 'Save a checkpoint of the current agent state for long-running task resumption.',
  requiresApproval: false,
  schema: CheckpointSaveArgs,
  async run(args, ctx) {
    const s = sessionStore.get(ctx.sessionId);
    if (!s) return 'Session not found';
    const messageIndex = s.messages.length;
    const toolCallsSoFar = s.messages.filter((m) => m.role === 'tool').length;
    const id = nanoid(8);
    const cp = { id, ts: Date.now(), messageIndex, summary: args.summary, toolCallsSoFar };
    sessionStore.addCheckpoint(ctx.sessionId, cp);
    return `Checkpoint saved [${id}] at message ${messageIndex} (${toolCallsSoFar} tool calls): ${args.summary}`;
  },
};

export const checkpointListTool: Tool<typeof CheckpointListArgs._type> = {
  name: 'checkpoint_list',
  description: 'List all checkpoints for the current session.',
  requiresApproval: false,
  schema: CheckpointListArgs,
  async run(_args, ctx) {
    const s = sessionStore.get(ctx.sessionId);
    if (!s) return 'Session not found';
    const cps = s.checkpoints ?? [];
    if (cps.length === 0) return 'No checkpoints yet.';
    return cps
      .map((c) => `[${c.id}] msg=${c.messageIndex} tools=${c.toolCallsSoFar} @ ${new Date(c.ts).toISOString()}\n  ${c.summary}`)
      .join('\n\n');
  },
};
