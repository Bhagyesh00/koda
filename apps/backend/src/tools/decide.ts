import { DecideArgs } from '@koda/shared';
import type { Tool } from './registry.js';

/**
 * The `decide` tool doesn't execute anything itself.
 * The agent loop intercepts it before calling run(), emits a `decision_request`
 * SSE event, and awaits the user's choice via the approval queue.
 * This run() is a fallback that should never be reached.
 */
export const decideTool: Tool<DecideArgs> = {
  name: 'decide',
  description: 'Present a structured decision to the user and pause until they pick an option.',
  requiresApproval: false,
  schema: DecideArgs,
  async run(_args, _ctx) {
    return 'Decision acknowledged.';
  },
};
