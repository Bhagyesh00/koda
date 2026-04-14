import { z } from 'zod';
import type { Tool } from './registry.js';

export const ProofArgs = z.object({
  description: z.string().min(1).describe('What property this proof verifies'),
  command: z.string().min(1).describe('Shell command — exit code 0 means proof passed'),
});
export type ProofArgs = z.infer<typeof ProofArgs>;

/**
 * Stub: the agent loop intercepts this tool before execution and handles
 * the proof registration directly. This object only exists so the tool
 * shows up in the registry and LLM tool descriptor list.
 */
export const proofTool: Tool<ProofArgs> = {
  name: 'proof',
  description:
    'Register a verification command that will run automatically after your next code change. ' +
    'If the command exits non-zero, the user is warned. Use for test commands, type checks, or ' +
    'property assertions that must hold after your change.',
  requiresApproval: false,
  schema: ProofArgs,
  async run() {
    return 'proof registered — will run after next mutation';
  },
};
