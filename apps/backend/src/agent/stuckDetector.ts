/**
 * Auto-think / strategy-reset hint generator.
 *
 * The existing retry path in [loop.ts] injects a per-tool `buildErrorHint`
 * after each failure ("retry but try a different approach"). That works for
 * isolated mistakes but fails the user when the model is genuinely stuck —
 * three consecutive tool failures usually mean the *whole approach* is wrong,
 * not just the last call's args.
 *
 * This module detects that pattern and produces a stronger reset prompt that
 * tells the model:
 *   1. Stop reacting tactically
 *   2. Reflect on the common assumption breaking each attempt
 *   3. Propose 2-3 *fundamentally different* approaches (not arg tweaks)
 *   4. Pick one and try it
 *
 * Triggered exclusively by the agent loop after a tool failure, NOT inside the
 * model — so the model can't ignore it.
 */

export interface FailureRecord {
  tool: string;
  errorPreview: string;
  ts: number;
}

/**
 * Number of consecutive failures before we shift from "retry hint" to "strategy reset".
 * Empirically: by the third failure of the same plan, the model is no longer
 * exploring — it's repeating with cosmetic variation. 3 is the sweet spot
 * between false-positives (one-off transient errors) and wasted iterations.
 */
export const STUCK_THRESHOLD = 3;

/** Maximum failures retained for the next strategy-reset hint render. */
export const FAILURE_WINDOW = 5;

/**
 * Mutable view of the part of TurnState this module owns. Defined as a
 * structural type so the helper can be unit-tested without constructing a
 * full TurnState (which depends on SSE/sessions/etc.).
 */
export interface FailureTrackingState {
  consecutiveFailures: number;
  recentFailures: FailureRecord[];
}

/**
 * Pure helper invoked by [loop.ts] after every tool call to update the
 * failure-tracking state.
 *
 * On failure: increments the counter, appends the record (capped at
 * FAILURE_WINDOW entries), and returns true when the threshold is reached
 * so the caller pushes a strategy-reset hint.
 *
 * On success: resets the counter so transient failures earlier in the turn
 * don't trigger a reset later. The recentFailures tail is preserved for
 * audit/debug purposes — the threshold gate uses the counter, not the array.
 *
 * Returns true exactly when the caller should emit a reset hint.
 */
export function recordToolOutcome(
  state: FailureTrackingState,
  outcome: { ok: boolean; tool: string; errorPreview: string; ts: number },
): boolean {
  if (outcome.ok) {
    state.consecutiveFailures = 0;
    return false;
  }
  state.consecutiveFailures += 1;
  state.recentFailures.push({
    tool: outcome.tool,
    errorPreview: outcome.errorPreview,
    ts: outcome.ts,
  });
  if (state.recentFailures.length > FAILURE_WINDOW) {
    state.recentFailures.shift();
  }
  return state.consecutiveFailures >= STUCK_THRESHOLD;
}

/**
 * Build the strategy-reset hint shown to the model when it has accumulated
 * `STUCK_THRESHOLD+` consecutive tool failures. The text is structured so a
 * small local model can follow each step without freelancing — concrete
 * questions force concrete reasoning.
 */
export function buildStrategyResetHint(failures: FailureRecord[]): string {
  const recent = failures.slice(-5);
  const summary = recent
    .map((f, i) => `${i + 1}. ${f.tool} — ${f.errorPreview.slice(0, 200)}`)
    .join('\n');

  const escalation =
    failures.length >= 5
      ? '\n\nThis is your FIFTH failed attempt. If you cannot identify a different approach, stop and tell the user what you tried and why each failed — do NOT keep trying.'
      : '';

  return `<strategy_reset failures="${failures.length}">
You have failed ${failures.length} consecutive tool calls. Reactive retries with small arg tweaks are not working — the underlying plan is wrong.

Recent failures:
${summary}

STOP. Before your next tool call, think in <think> tags about THREE specific questions:

1. **What single assumption is shared by all the attempts above?** (e.g. "I assumed file X exists", "I assumed the command runs on this OS", "I assumed the schema accepts a 'file' key")

2. **What concrete evidence contradicts that assumption?** (Cite the exact error text from a recent failure.)

3. **List 2-3 FUNDAMENTALLY different approaches** — not "same call with different args". Examples of *fundamentally* different:
   - "Read a different file first to learn the actual structure"
   - "Use a different tool entirely (grep instead of read_file, list_dir instead of glob)"
   - "Ask the user a clarifying question if the goal is ambiguous"
   - "Check the platform / environment with a probe command"

Pick the most promising approach and explain in one sentence WHY it should work where the others didn't. Then make exactly ONE tool call implementing it.${escalation}
</strategy_reset>`;
}
