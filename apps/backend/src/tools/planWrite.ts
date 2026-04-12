import fs from 'node:fs/promises';
import path from 'node:path';
import { PlanWriteArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { config } from '../config.js';
import { sessionStore } from '../sessions/store.js';

const PLANS_DIR = path.join(config.WORK_DIR_ABS, '.koda', 'plans');

export function planFilePath(sessionId: string): string {
  return path.join(PLANS_DIR, `${sessionId}.md`);
}

export const planWriteTool: Tool<typeof PlanWriteArgs._type> = {
  name: 'plan_write',
  description:
    'Save your full implementation plan as markdown. Only available in plan mode. Call this exactly once when your investigation is complete.',
  requiresApproval: false,
  schema: PlanWriteArgs,
  async run(args, ctx) {
    await fs.mkdir(PLANS_DIR, { recursive: true });
    const file = planFilePath(ctx.sessionId);
    await fs.writeFile(file, args.content, 'utf8');
    const session = sessionStore.get(ctx.sessionId);
    if (session) {
      session.planPath = path.relative(config.WORK_DIR_ABS, file);
      sessionStore.update(session);
    }
    return `Plan saved (${args.content.length} chars). Awaiting user approval to enter Build mode.`;
  },
};
