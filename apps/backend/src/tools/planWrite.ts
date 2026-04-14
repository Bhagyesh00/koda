import fs from 'node:fs/promises';
import path from 'node:path';
import { PlanWriteArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { sessionStore } from '../sessions/store.js';

/**
 * Return the absolute path to a session's plan file.
 * Plans live under `<workDir>/.koda/plans/<sessionId>.md` so each session's
 * plan is stored alongside the files it describes.
 */
export function planFilePath(sessionId: string, workDir: string): string {
  return path.join(workDir, '.koda', 'plans', `${sessionId}.md`);
}

export const planWriteTool: Tool<typeof PlanWriteArgs._type> = {
  name: 'plan_write',
  description:
    'Save your full implementation plan as markdown. Only available in plan mode. Call this exactly once when your investigation is complete.',
  requiresApproval: false,
  schema: PlanWriteArgs,
  async run(args, ctx) {
    const plansDir = path.join(ctx.workDir, '.koda', 'plans');
    await fs.mkdir(plansDir, { recursive: true });
    const file = planFilePath(ctx.sessionId, ctx.workDir);
    await fs.writeFile(file, args.content, 'utf8');
    const session = sessionStore.get(ctx.sessionId);
    if (session) {
      // Store the absolute path so plans.ts can find it regardless of cwd changes
      session.planPath = file;
      sessionStore.update(session);
    }
    return `Plan saved (${args.content.length} chars). Awaiting user approval to enter Build mode.`;
  },
};
