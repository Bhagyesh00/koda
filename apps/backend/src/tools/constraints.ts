import { nanoid } from 'nanoid';
import { ConstraintAddArgs, ConstraintListArgs, ConstraintRemoveArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { sessionStore } from '../sessions/store.js';

export const constraintAddTool: Tool<typeof ConstraintAddArgs._type> = {
  name: 'constraint_add',
  description:
    'Add a persistent constraint to the session (functional, non-functional, security, architecture, domain, performance). Injected into every future system prompt.',
  requiresApproval: false,
  schema: ConstraintAddArgs,
  async run(args, ctx) {
    const id = nanoid(8);
    const constraint = { id, type: args.type, text: args.text, createdAt: Date.now() };
    sessionStore.addConstraint(ctx.sessionId, constraint);
    return `Constraint added: [${id}] (${args.type}) ${args.text}`;
  },
};

export const constraintListTool: Tool<typeof ConstraintListArgs._type> = {
  name: 'constraint_list',
  description: 'List all persistent constraints for the current session.',
  requiresApproval: false,
  schema: ConstraintListArgs,
  async run(args, ctx) {
    const s = sessionStore.get(ctx.sessionId);
    if (!s) return 'Session not found';
    let list = s.constraints ?? [];
    if (args.type) list = list.filter((c) => c.type === args.type);
    if (list.length === 0) return 'No constraints.';
    return list.map((c) => `[${c.id}] (${c.type}) ${c.text}`).join('\n');
  },
};

export const constraintRemoveTool: Tool<typeof ConstraintRemoveArgs._type> = {
  name: 'constraint_remove',
  description: 'Remove a persistent constraint by id.',
  requiresApproval: false,
  schema: ConstraintRemoveArgs,
  async run(args, ctx) {
    const ok = sessionStore.removeConstraint(ctx.sessionId, args.id);
    return ok ? `Removed constraint ${args.id}` : `Constraint ${args.id} not found`;
  },
};
