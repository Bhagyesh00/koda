import { MultiAgentArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { streamOllamaChat, type OllamaMessage } from '../agent/ollama.js';
import { logger } from '../logger.js';

interface BlackboardEntry {
  agentRole: string;
  round: number;
  content: string;
  ts: number;
}

/**
 * Orchestrates parallel agents with a shared blackboard. Each round, every agent
 * reads the blackboard state and posts its contribution. Final output is a
 * merged synthesis of all rounds.
 */
export const multiAgentTool: Tool<typeof MultiAgentArgs._type> = {
  name: 'multi_agent',
  description:
    'Orchestrate parallel sub-agents with a shared blackboard. Agents can post findings and read each other\'s work. Requires approval.',
  requiresApproval: true,
  schema: MultiAgentArgs,
  async run(args, ctx) {
    const blackboard: BlackboardEntry[] = [];
    const maxRounds = args.maxRounds ?? 3;

    for (let round = 1; round <= maxRounds; round++) {
      logger.info({ round, agents: args.agents.length }, 'multi_agent round start');

      // Run all agents in parallel for this round
      const roundResults = await Promise.all(
        args.agents.map(async (agent) => {
          const blackboardText =
            blackboard.length === 0
              ? '(blackboard empty — you are first)'
              : blackboard
                  .map((b) => `[${b.agentRole} · round ${b.round}]\n${b.content}`)
                  .join('\n\n');

          const messages: OllamaMessage[] = [
            {
              role: 'system',
              content:
                `You are a "${agent.role}" agent collaborating with other specialists.\n` +
                `Shared goal: ${args.goal}\n\n` +
                `Blackboard (other agents' contributions):\n${blackboardText}\n\n` +
                `Round: ${round} of ${maxRounds}. ` +
                `Contribute your specific expertise. Be concise and build on what others have said.`,
            },
            { role: 'user', content: agent.prompt },
          ];

          let out = '';
          try {
            await streamOllamaChat(
              messages,
              (delta) => { out += delta; },
              ctx.signal,
              { temperature: 0.3 },
            );
          } catch (e) {
            out = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
          }
          return { agentRole: agent.role, content: out.trim(), round, ts: Date.now() };
        }),
      );

      blackboard.push(...roundResults);

      // Early exit if all agents say converged
      const allConverged = roundResults.every(
        (r) => /\b(converged|done|final|no further changes)\b/i.test(r.content.slice(-200)),
      );
      if (allConverged) {
        logger.info({ round }, 'multi_agent converged early');
        break;
      }
    }

    // Final synthesis
    const synthesis = blackboard
      .map((b) => `## ${b.agentRole} (round ${b.round})\n\n${b.content}`)
      .join('\n\n---\n\n');

    return `Multi-agent coordination complete: ${args.agents.length} agents × ${Math.min(maxRounds, Math.max(...blackboard.map((b) => b.round)))} rounds\n\n${synthesis}`;
  },
};
