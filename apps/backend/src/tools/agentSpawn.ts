import { nanoid } from 'nanoid';
import { AgentSpawnArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runSubAgent } from '../agent/subAgent.js';

export const agentSpawnTool: Tool<typeof AgentSpawnArgs._type> = {
  name: 'agent_spawn',
  description: 'Spawn parallel sub-agents to work on independent tasks simultaneously.',
  requiresApproval: false,
  schema: AgentSpawnArgs,

  async run(args, ctx) {
    // allSettled — one failing sub-agent must not poison sibling results.
    // Each task gets a stable agentId so the UI can correlate streamed
    // subagent_event/update messages back to a tile.
    const settled = await Promise.allSettled(
      args.tasks.map(async (task) => {
        const agentId = nanoid(8);
        ctx.sse?.send({
          type: 'subagent_update',
          agentId,
          status: 'running',
          description: task.description,
        });
        try {
          const result = await runSubAgent(
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
            (event) => {
              ctx.sse?.send({
                type: 'subagent_event',
                agentId,
                event: event.type,
                text: event.text,
                tool: event.tool,
                args: event.args,
                output: event.output,
                ok: event.ok,
              });
            },
          );
          ctx.sse?.send({ type: 'subagent_update', agentId, status: 'done', result, description: task.description });
          return { description: task.description, result, ok: true as const };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.sse?.send({ type: 'subagent_update', agentId, status: 'error', result: msg, description: task.description });
          return { description: task.description, result: `Error: ${msg}`, ok: false as const };
        }
      }),
    );

    return settled
      .map((s, i) => {
        // allSettled itself never rejects — but our inner try/catch returns the
        // failure shape, so this branch only fires for true unexpected throws
        // (e.g. nanoid out-of-entropy, scheduler bug). Surface them anyway.
        if (s.status === 'rejected') {
          return `## Agent ${i + 1}: (unknown)\n\nError: ${String(s.reason)}`;
        }
        const tag = s.value.ok ? '' : ' [failed]';
        return `## Agent ${i + 1}: ${s.value.description}${tag}\n\n${s.value.result}`;
      })
      .join('\n\n---\n\n');
  },
};
