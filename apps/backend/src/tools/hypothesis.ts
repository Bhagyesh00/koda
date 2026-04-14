import { HypothesisArgs } from '@koda/shared';
import type { Tool } from './registry.js';

/**
 * The `hypothesis` tool is intercepted by the agent loop before run().
 * The loop stores the hypothesis and returns a confirmation so the agent
 * can proceed. Verification is run automatically after the next bash call.
 */
export const hypothesisTool: Tool<HypothesisArgs> = {
  name: 'hypothesis',
  description: 'Record a testable hypothesis before making a change.',
  requiresApproval: false,
  schema: HypothesisArgs,
  async run(_args, _ctx) {
    return 'Hypothesis recorded. Proceed with your changes. The system will auto-verify.';
  },
};
