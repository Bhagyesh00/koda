import { MultiAgentArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { streamOllamaChat, type OllamaMessage } from '../agent/ollama.js';
import { logger } from '../logger.js';
import {
  type BlackboardEntry,
  parseContribution,
  buildAgentSystemPrompt,
  buildSynthesisPrompt,
  aggregateBlackboard,
  renderAggregation,
} from './multiAgent.helpers.js';

const SYNTH_TEMPERATURE = 0.2;
const AGENT_TEMPERATURE = 0.3;

/**
 * Phase 4 — Multi-Agent Structured Debate.
 *
 * Orchestrates parallel agents with a shared blackboard. Each round, every
 * agent reads the structured contributions of the others and posts its own
 * (`{claim, evidence, confidence, dissents}`). After all rounds, a synthesizer
 * arbitrates and produces a final recommendation; a deterministic aggregation
 * is appended as a safety net so consensus and disputes are always visible
 * even when the LLM synthesis fails.
 *
 * The previous free-form behaviour is preserved by passing `structured: false`.
 */
export const multiAgentTool: Tool<typeof MultiAgentArgs._type> = {
  name: 'multi_agent',
  description:
    'Orchestrate parallel sub-agents with a shared blackboard. Agents can post structured findings (claim/evidence/dissents) and an arbitrator produces a final recommendation. Requires approval.',
  requiresApproval: true,
  schema: MultiAgentArgs,
  async run(args, ctx) {
    const blackboard: BlackboardEntry[] = [];
    const maxRounds = args.maxRounds ?? 3;
    const structured = args.structured ?? true;
    const synthesize = args.synthesize ?? true;

    for (let round = 1; round <= maxRounds; round++) {
      logger.info({ round, agents: args.agents.length, structured }, 'multi_agent round start');

      const roundResults = await Promise.all(
        args.agents.map(async (agent): Promise<BlackboardEntry> => {
          const systemPrompt = buildAgentSystemPrompt({
            goal: args.goal,
            role: agent.role,
            skill: agent.skill,
            userPrompt: agent.prompt,
            round,
            maxRounds,
            blackboard,
            structured,
          });
          const messages: OllamaMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: agent.prompt },
          ];

          let raw = '';
          try {
            await streamOllamaChat(
              messages,
              (delta) => { raw += delta; },
              ctx.signal,
              { temperature: AGENT_TEMPERATURE },
            );
          } catch (e) {
            raw = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
          }

          const parsed = structured ? parseContribution(raw) : null;
          return {
            agentRole: agent.role,
            round,
            ts: Date.now(),
            raw: raw.trim(),
            parsed: parsed != null,
            ...(parsed ? { structured: parsed } : {}),
          };
        }),
      );

      blackboard.push(...roundResults);

      // Early-exit heuristics:
      //  (a) structured mode — every parsed contribution reports confidence ≥ 90 and no dissents
      //  (b) free-form fallback — every agent says "converged" / "done" / "final"
      const allHighConfNoDissent =
        structured &&
        roundResults.every(
          (r) => r.parsed && r.structured!.confidence >= 90 && r.structured!.dissents.length === 0,
        );
      const allConvergedFreeform =
        !structured &&
        roundResults.every((r) =>
          /\b(converged|done|final|no further changes)\b/i.test(r.raw.slice(-200)),
        );
      if (allHighConfNoDissent || allConvergedFreeform) {
        logger.info({ round, reason: allHighConfNoDissent ? 'consensus' : 'free-form converged' }, 'multi_agent early exit');
        break;
      }
    }

    // ── Synthesis pass ────────────────────────────────────────────────────────
    let synthesis = '';
    if (synthesize) {
      try {
        const synthMessages: OllamaMessage[] = [
          { role: 'system', content: buildSynthesisPrompt({ goal: args.goal, blackboard }) },
          { role: 'user', content: 'Produce the synthesis report now.' },
        ];
        await streamOllamaChat(
          synthMessages,
          (delta) => { synthesis += delta; },
          ctx.signal,
          { temperature: SYNTH_TEMPERATURE },
        );
        synthesis = synthesis.trim();
      } catch (e) {
        logger.warn({ err: e }, 'multi_agent synthesis failed — falling back to deterministic aggregation only');
      }
    }

    // Deterministic aggregation always runs — provides a structured floor even
    // when the LLM synthesis is empty, garbled, or skipped.
    const aggregation = aggregateBlackboard(blackboard);
    const aggReport = renderAggregation(aggregation);

    // Verbose per-contribution dump appended last for transparency / debugging.
    const transcript = blackboard
      .map((b) => {
        if (b.structured) {
          const dissents = b.structured.dissents.length
            ? `\n\n*Dissents:* ${b.structured.dissents.map((d) => `[${d.targetRole}] ${d.reason}`).join('; ')}`
            : '';
          const evidence = b.structured.evidence.length
            ? `\n\n*Evidence:*\n- ${b.structured.evidence.join('\n- ')}`
            : '';
          return (
            `## ${b.agentRole} — round ${b.round} (confidence ${b.structured.confidence})\n\n` +
            `**Claim:** ${b.structured.claim}${evidence}${dissents}`
          );
        }
        return `## ${b.agentRole} — round ${b.round} (unstructured)\n\n${b.raw}`;
      })
      .join('\n\n---\n\n');

    const header = `Multi-agent debate complete: ${args.agents.length} agents × ${aggregation.rounds} round${aggregation.rounds === 1 ? '' : 's'} (${aggregation.parsedContributions}/${aggregation.totalContributions} structured)`;

    const sections: string[] = [header];
    if (synthesis) {
      sections.push(`# Arbitrated synthesis\n\n${synthesis}`);
    }
    sections.push(aggReport);
    sections.push(`# Full transcript\n\n${transcript}`);
    return sections.join('\n\n---\n\n');
  },
};
