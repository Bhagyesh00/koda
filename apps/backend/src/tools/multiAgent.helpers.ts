import { z } from 'zod';
import { getSkill } from '../skills/registry.js';

/**
 * Phase 4 — Multi-Agent Structured Debate.
 *
 * Helpers split out of `multiAgent.ts` so the parser, role→skill mapper, and
 * prompt builders are unit-testable without spinning up Ollama.
 */

// ── Structured contribution shape ────────────────────────────────────────────

export const ContributionSchema = z.object({
  /** Single declarative sentence summarising the agent's position this round. */
  claim: z.string().min(1),
  /** Bullet evidence the agent stands on (file:line citations encouraged). */
  evidence: z.array(z.string()).default([]),
  /** Self-rated confidence 0–100. */
  confidence: z.number().int().min(0).max(100).default(50),
  /** Disagreements with prior contributions on the blackboard. */
  dissents: z
    .array(
      z.object({
        targetRole: z.string(),
        targetClaim: z.string(),
        reason: z.string(),
      }),
    )
    .default([]),
  /** Free-form notes (not used in synthesis but kept for transparency). */
  notes: z.string().optional(),
});
export type Contribution = z.infer<typeof ContributionSchema>;

export interface BlackboardEntry {
  agentRole: string;
  round: number;
  ts: number;
  /** Structured contribution if the LLM produced parseable JSON. */
  structured?: Contribution;
  /** Raw LLM output — always set, used as fallback when structured is missing. */
  raw: string;
  /** True when JSON parse succeeded; false when we fell back to free-form. */
  parsed: boolean;
}

// ── Role → skill mapping ─────────────────────────────────────────────────────

/**
 * Common short role names users might pass (`security`, `qa`, `architecture`)
 * mapped to the existing skill slugs in skills/definitions.ts. Built so a user
 * can write `{ role: "security", prompt: "..." }` and get the right persona
 * without knowing the full slug.
 */
const ROLE_ALIASES: Record<string, string> = {
  security: 'senior-security-engineer',
  performance: 'senior-backend-developer',
  perf: 'senior-backend-developer',
  qa: 'senior-qa-engineer',
  test: 'senior-qa-engineer',
  testing: 'senior-qa-engineer',
  architecture: 'senior-software-architect',
  architect: 'senior-software-architect',
  backend: 'senior-backend-developer',
  frontend: 'senior-frontend-developer',
  devops: 'senior-devops-engineer',
  sre: 'senior-devops-engineer',
  ml: 'senior-ml-ai-engineer',
  ai: 'senior-ml-ai-engineer',
  dba: 'senior-dba',
  database: 'senior-dba',
};

/**
 * Resolve an agent's effective skill prompt addition. Explicit `skill` wins,
 * otherwise we try to alias from the role name. Returns undefined when no
 * skill matches — caller should fall back to a generic system prompt.
 */
export function resolveAgentSkill(opts: {
  role: string;
  skill?: string;
}): string | undefined {
  const explicit = opts.skill ? getSkill(opts.skill) : undefined;
  if (explicit) return explicit.promptAddition;
  const aliasSlug = ROLE_ALIASES[opts.role.trim().toLowerCase()];
  if (aliasSlug) {
    const skill = getSkill(aliasSlug);
    if (skill) return skill.promptAddition;
  }
  return undefined;
}

// ── Contribution parsing ─────────────────────────────────────────────────────

/**
 * Try to find a JSON object literal in the LLM output. Looks first for a
 * fenced ```json ... ``` block, then for the largest top-level `{...}`.
 *
 * Returns null if no parseable JSON is found.
 */
function extractJsonBlock(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  if (fence?.[1]) return fence[1].trim();
  // Fall back to the first balanced { ... } that parses.
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse an agent's raw output into a Contribution. Returns null when the
 * output isn't structured (the caller falls back to free-form mode).
 */
export function parseContribution(raw: string): Contribution | null {
  const block = extractJsonBlock(raw);
  if (!block) return null;
  try {
    const parsed = JSON.parse(block);
    const validated = ContributionSchema.safeParse(parsed);
    if (validated.success) return validated.data;
    return null;
  } catch {
    return null;
  }
}

// ── Prompt builders ──────────────────────────────────────────────────────────

const STRUCTURED_OUTPUT_INSTRUCTION = `Respond with a SINGLE JSON object inside a \`\`\`json fenced block. Schema:
{
  "claim": "<one declarative sentence stating your position this round>",
  "evidence": ["<bullet>", "<bullet>"],
  "confidence": <integer 0-100>,
  "dissents": [
    { "targetRole": "<other agent role>", "targetClaim": "<their claim>", "reason": "<why you disagree>" }
  ],
  "notes": "<optional free-form follow-up>"
}
Keep claim under 200 chars. Evidence items should cite file paths or specific facts. Omit dissents when you fully agree. Do NOT add prose outside the JSON block.`;

function renderBlackboard(entries: BlackboardEntry[]): string {
  if (entries.length === 0) return '(blackboard empty — you are first)';
  return entries
    .map((e) => {
      if (e.structured) {
        const dissents = e.structured.dissents.length
          ? `\n  dissents: ${e.structured.dissents
              .map((d) => `[${d.targetRole}] ${d.reason}`)
              .join('; ')}`
          : '';
        const evidence = e.structured.evidence.length
          ? `\n  evidence: ${e.structured.evidence.join('; ')}`
          : '';
        return `[${e.agentRole} · round ${e.round} · confidence ${e.structured.confidence}]\n  claim: ${e.structured.claim}${evidence}${dissents}`;
      }
      return `[${e.agentRole} · round ${e.round} · unstructured]\n${e.raw.slice(0, 600)}`;
    })
    .join('\n\n');
}

export interface AgentPromptOpts {
  goal: string;
  role: string;
  skill?: string;
  userPrompt: string;
  round: number;
  maxRounds: number;
  blackboard: BlackboardEntry[];
  structured: boolean;
}

export function buildAgentSystemPrompt(opts: AgentPromptOpts): string {
  const skillAddition = resolveAgentSkill({ role: opts.role, skill: opts.skill });
  const skillBlock = skillAddition ? `\n\n${skillAddition}\n\n` : '\n\n';
  const blackboard = renderBlackboard(opts.blackboard);
  const formatBlock = opts.structured
    ? `\n\n${STRUCTURED_OUTPUT_INSTRUCTION}`
    : '';
  return (
    `You are the "${opts.role}" agent collaborating with other specialists.${skillBlock}` +
    `Shared goal: ${opts.goal}\n\n` +
    `Blackboard (other agents' contributions so far):\n${blackboard}\n\n` +
    `Round: ${opts.round} of ${opts.maxRounds}. ` +
    `Contribute your specific expertise. If a prior contribution looks wrong from your angle, file a dissent — don't paper over disagreement.` +
    formatBlock
  );
}

// ── Synthesizer ──────────────────────────────────────────────────────────────

export interface SynthesisInput {
  goal: string;
  blackboard: BlackboardEntry[];
}

/**
 * Build the system prompt for the arbitration pass. The synthesizer reads the
 * full structured blackboard and produces a markdown report of consensus,
 * disputes, and a final recommendation.
 */
export function buildSynthesisPrompt(input: SynthesisInput): string {
  const board = renderBlackboard(input.blackboard);
  return (
    `You are the synthesis arbiter for a multi-agent debate.\n\n` +
    `Goal: ${input.goal}\n\n` +
    `Full blackboard:\n${board}\n\n` +
    `Produce a markdown report with these exact sections (omit empty ones):\n` +
    `## Consensus — claims supported by 2+ agents with no dissents\n` +
    `## Disputes — claims with active dissents; list the dissenting role and reason\n` +
    `## Final recommendation — your arbitrated decision, accounting for confidences and dissents\n` +
    `## Open questions — anything unresolved\n\n` +
    `Be opinionated in the recommendation. Don't just summarise — pick a side and justify it.`
  );
}

/**
 * Deterministic *non-LLM* aggregation that runs as a safety net even when the
 * synthesizer LLM call fails or is disabled. It surfaces consensus and disputes
 * so the user always sees the structured outcome of the debate.
 */
export interface DebateAggregation {
  totalContributions: number;
  parsedContributions: number;
  rounds: number;
  consensus: Array<{ claim: string; supportingRoles: string[]; avgConfidence: number }>;
  disputes: Array<{
    targetRole: string;
    targetClaim: string;
    dissents: Array<{ fromRole: string; reason: string }>;
  }>;
}

export function aggregateBlackboard(blackboard: BlackboardEntry[]): DebateAggregation {
  const parsed = blackboard.filter((e) => e.parsed && e.structured);
  const rounds = blackboard.reduce((m, e) => Math.max(m, e.round), 0);

  // Group by claim text (case-insensitive trim) — agents that restate the
  // same position across rounds count as one supporter, not many.
  const byClaim = new Map<
    string,
    { claim: string; roles: Set<string>; confidences: number[] }
  >();
  for (const e of parsed) {
    const claim = e.structured!.claim.trim();
    const key = claim.toLowerCase();
    let bucket = byClaim.get(key);
    if (!bucket) {
      bucket = { claim, roles: new Set(), confidences: [] };
      byClaim.set(key, bucket);
    }
    bucket.roles.add(e.agentRole);
    bucket.confidences.push(e.structured!.confidence);
  }

  // Disputes: index by (targetRole, targetClaim) and accumulate dissents.
  const disputeMap = new Map<
    string,
    { targetRole: string; targetClaim: string; dissents: Array<{ fromRole: string; reason: string }> }
  >();
  for (const e of parsed) {
    for (const d of e.structured!.dissents) {
      const key = `${d.targetRole}::${d.targetClaim}`.toLowerCase();
      let bucket = disputeMap.get(key);
      if (!bucket) {
        bucket = { targetRole: d.targetRole, targetClaim: d.targetClaim, dissents: [] };
        disputeMap.set(key, bucket);
      }
      bucket.dissents.push({ fromRole: e.agentRole, reason: d.reason });
    }
  }

  const consensus = Array.from(byClaim.values())
    .filter((b) => b.roles.size >= 2)
    .map((b) => ({
      claim: b.claim,
      supportingRoles: Array.from(b.roles),
      avgConfidence: Math.round(b.confidences.reduce((a, c) => a + c, 0) / b.confidences.length),
    }));

  return {
    totalContributions: blackboard.length,
    parsedContributions: parsed.length,
    rounds,
    consensus,
    disputes: Array.from(disputeMap.values()),
  };
}

/** Render the deterministic aggregation as a markdown fallback report. */
export function renderAggregation(agg: DebateAggregation): string {
  const lines: string[] = [];
  lines.push(`### Debate stats`);
  lines.push(
    `- ${agg.totalContributions} contributions across ${agg.rounds} round${agg.rounds === 1 ? '' : 's'} ` +
      `(${agg.parsedContributions} structured, ${agg.totalContributions - agg.parsedContributions} free-form)`,
  );
  if (agg.consensus.length > 0) {
    lines.push('');
    lines.push('### Consensus');
    for (const c of agg.consensus) {
      lines.push(
        `- "${c.claim}" — supported by ${c.supportingRoles.join(', ')} ` +
          `(avg confidence ${c.avgConfidence})`,
      );
    }
  }
  if (agg.disputes.length > 0) {
    lines.push('');
    lines.push('### Disputes');
    for (const d of agg.disputes) {
      lines.push(`- **[${d.targetRole}]** "${d.targetClaim}"`);
      for (const dis of d.dissents) {
        lines.push(`  - ↳ [${dis.fromRole}] ${dis.reason}`);
      }
    }
  }
  return lines.join('\n');
}
