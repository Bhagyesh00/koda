import { minimatch } from 'minimatch';
import type { GuardRule, RiskTier } from '@koda/shared';

export interface GuardResult {
  triggered: boolean;
  rule?: GuardRule;
}

const TIER_RANK: Record<RiskTier, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/**
 * Evaluate pattern guardrail rules against an about-to-run tool call.
 * Returns the first matching rule (block takes priority over warn if both match).
 *
 * `risk_tier` and `architecture` rules are evaluated by their own dedicated
 * functions below — they don't participate in the block/warn decision here.
 */
export function evaluateGuardrails(
  rules: GuardRule[],
  toolName: string,
  args: unknown,
): GuardResult {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  const active = rules.filter(
    (r) => r.enabled && (r.kind ?? 'pattern') === 'pattern' && (r.action === 'block' || r.action === 'warn'),
  );

  // Collect all matching rules
  const matches = active.filter((rule) => matchesRule(rule, toolName, a));
  if (matches.length === 0) return { triggered: false };

  // Block takes priority over warn
  const blocker = matches.find((r) => r.action === 'block');
  return { triggered: true, rule: blocker ?? matches[0] };
}

/**
 * Evaluate risk-tier rules. Returns the highest tier that matches the call,
 * or null if no tier rule matches. The tier is later used by the agent loop
 * to force the approval gate even in expert / auto-approve modes.
 */
export function evaluateRiskTier(
  rules: GuardRule[],
  toolName: string,
  args: unknown,
): { tier: RiskTier; rule: GuardRule } | null {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  const tierRules = rules.filter(
    (r) => r.enabled && r.kind === 'risk_tier' && r.riskTier && matchesRule(r, toolName, a),
  );
  if (tierRules.length === 0) return null;
  // Pick the highest-rank tier across all matching rules.
  let winner = tierRules[0]!;
  for (const r of tierRules) {
    if (TIER_RANK[r.riskTier!] > TIER_RANK[winner.riskTier!]) winner = r;
  }
  return { tier: winner.riskTier!, rule: winner };
}

function matchesRule(rule: GuardRule, toolName: string, args: Record<string, unknown>): boolean {
  // Tool name check
  const toolMatches =
    rule.tools.includes('*') || rule.tools.includes(toolName);
  if (!toolMatches) return false;

  // Path pattern check (applies to tools with a `path` arg)
  if (rule.pathPattern) {
    const filePath = typeof args.path === 'string' ? args.path : null;
    if (!filePath) return false;
    if (!minimatch(filePath, rule.pathPattern, { dot: true, matchBase: true })) return false;
  }

  // Command pattern check (applies to bash tool)
  if (rule.commandPattern) {
    const cmd = typeof args.command === 'string' ? args.command : null;
    if (!cmd) return false;
    try {
      // Cache compiled regexes on the rule object to avoid recompilation per call.
      const cacheKey = `__re_${rule.commandPattern}`;
      let re = (rule as Record<string, unknown>)[cacheKey] as RegExp | undefined;
      if (!re) {
        re = new RegExp(rule.commandPattern, 'i');
        (rule as Record<string, unknown>)[cacheKey] = re;
      }
      if (!re.test(cmd)) return false;
    } catch {
      return false;
    }
  }

  return true;
}
