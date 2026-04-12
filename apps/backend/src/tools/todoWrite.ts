import { TodoWriteArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { sessionStore } from '../sessions/store.js';

export const todoWriteTool: Tool<typeof TodoWriteArgs._type> = {
  name: 'todo_write',
  description: 'Replace the session todo list with the given todos.',
  requiresApproval: false,
  schema: TodoWriteArgs,
  async run(args, ctx) {
    const session = sessionStore.get(ctx.sessionId);
    if (!session) return 'Error: session not found';
    session.todos = args.todos;
    sessionStore.update(session);
    return `Updated ${args.todos.length} todos`;
  },
};
