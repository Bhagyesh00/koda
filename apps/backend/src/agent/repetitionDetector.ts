/**
 * Stream-side guard that aborts the LLM response when it falls into a
 * degenerate repetition loop. Small local models (especially when they're
 * "thinking" out loud at low temperature) sometimes settle on a phrase and
 * emit it dozens of times before producing useful output.
 *
 * Two layered detectors run in parallel:
 *
 *   1. **Run-length detector** — 5 IDENTICAL non-trivial lines in a row.
 *      Catches the obvious "Wait, I will just run it." × 20 case.
 *
 *   2. **Cycle detector** — across the last CYCLE_WINDOW (≥10) non-trivial
 *      lines, if there are ≤ MAX_UNIQUE_LINES (3) unique values, the model
 *      is cycling between a small set of phrases (the failure mode in the
 *      "fix this project" report: a 3-line A/B/C/A/B/C pattern that
 *      identical-line check misses).
 *
 * Both detectors use the same per-line stream parser. Short lines
 * (<MIN_LINE_LENGTH) are *skipped* — not treated as resetters — because
 * blank lines between paragraphs would otherwise mask any cycle.
 *
 * Tuned conservatively: real generations don't reuse 7+ of their last 10
 * sentences verbatim. If they do, they've already failed.
 */
export class RepetitionDetector {
  private currentLine = '';
  /** Last N consecutive ≥12-char lines (newest at the end). */
  private runWindow: string[] = [];
  /** Last M ≥12-char lines for cycle detection (newest at the end). */
  private cycleWindow: string[] = [];
  /** Set the moment a detector trips, used by triggeringLine(). */
  private triggered: { reason: 'run' | 'cycle'; line: string } | null = null;

  /** How many consecutive duplicate lines trigger the run-length detector. */
  static readonly RUN_WINDOW = 5;
  /** How many recent lines the cycle detector considers. */
  static readonly CYCLE_WINDOW = 10;
  /** Maximum unique lines allowed in the cycle window before we trip. */
  static readonly MAX_UNIQUE_LINES = 3;
  /** Minimum line length to be considered for either detector. */
  static readonly MIN_LINE_LENGTH = 12;

  /**
   * Feed a chunk of streamed text. Returns `true` once a repetition loop has
   * been observed; thereafter it stays `true`. Caller should abort the stream
   * the first time `true` is returned.
   */
  feed(chunk: string): boolean {
    if (!chunk) return false;
    if (this.triggered) return true;
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (ch === '\n') {
        if (this.commitLine()) return true;
      } else {
        this.currentLine += ch;
      }
    }
    return false;
  }

  /** The line whose repetition triggered the trap — useful for error messages. */
  triggeringLine(): string | null {
    return this.triggered?.line ?? null;
  }

  /** Which detector caught it — useful for telemetry and the user message. */
  triggeringReason(): 'run' | 'cycle' | null {
    return this.triggered?.reason ?? null;
  }

  private commitLine(): boolean {
    const trimmed = this.currentLine.trim();
    this.currentLine = '';
    // Skip short / blank lines without disturbing either window. Resetting on
    // them was the original bug: paragraph breaks broke the run detector and
    // also masked cycles by inserting "blank" entries between repeats.
    if (trimmed.length < RepetitionDetector.MIN_LINE_LENGTH) return false;

    // ── Detector 1: identical lines in a row ───────────────────────────────
    this.runWindow.push(trimmed);
    if (this.runWindow.length > RepetitionDetector.RUN_WINDOW) this.runWindow.shift();
    if (this.runWindow.length === RepetitionDetector.RUN_WINDOW) {
      const first = this.runWindow[0]!;
      if (this.runWindow.every((l) => l === first)) {
        this.triggered = { reason: 'run', line: first };
        return true;
      }
    }

    // ── Detector 2: small set of lines cycling ─────────────────────────────
    this.cycleWindow.push(trimmed);
    if (this.cycleWindow.length > RepetitionDetector.CYCLE_WINDOW) {
      this.cycleWindow.shift();
    }
    if (this.cycleWindow.length === RepetitionDetector.CYCLE_WINDOW) {
      const unique = new Set(this.cycleWindow);
      if (unique.size <= RepetitionDetector.MAX_UNIQUE_LINES) {
        // Trigger on the most-recent line so the error message shows what
        // the model is currently saying when we abort.
        this.triggered = { reason: 'cycle', line: trimmed };
        return true;
      }
    }
    return false;
  }
}

/** Marker error code surfaced through the agent loop's existing error path. */
export const REPETITION_LOOP_CODE = 'repetition_loop';

/** Build a friendly error explaining what happened and what to try. */
export function repetitionLoopError(line: string | null, reason: 'run' | 'cycle' | null = null): Error {
  const sample = line ? ` ("${line.slice(0, 60)}${line.length > 60 ? '…' : ''}")` : '';
  const what =
    reason === 'cycle'
      ? 'cycling between a small set of phrases'
      : 'emitting the same line repeatedly';
  const err = new Error(
    `The model entered a repetition loop${sample} — ${what} — and was stopped.\n` +
    `Try: (a) sending the message again, (b) shortening the input, or ` +
    `(c) raising temperature / lowering num_ctx in config so the sampler has ` +
    `more variation. Smaller local models are most prone to this.`,
  );
  (err as Error & { code?: string }).code = REPETITION_LOOP_CODE;
  return err;
}
