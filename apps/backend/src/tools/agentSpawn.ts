import { AgentSpawnArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runSubAgent } from '../agent/subAgent.js';

export const agentSpawnTool: Tool<typeof AgentSpawnArgs._type> = {
  name: 'agent_spawn',
  description: 'Spawn parallel sub-agents to work on independent tasks simultaneously.',
  requiresApproval: false,
  schema: AgentSpawnArgs,

  async run(args, ctx) {
    const results = await Promise.all(
      args.tasks.map(async (task) =>
        runSubAgent(
          {
            description: task.description,
            prompt: task.prompt,
            skill: task.skill,
            maxIterations: task.maxIterations ?? 5,
          },
          {
            sessionId: ctx.sessionId,
            workDir: ctx.workDir,
            signal: ctx.signal,
          },
          () => { /* events not forwarded in v1 */ },
        ).then((result) => ({ description: task.description, result })),
      ),
    );

    return results
      .map((r, i) => `## Agent ${i + 1}: ${r.description}\n\n${r.result}`)
      .join('\n\n---\n\n');
  },
};
