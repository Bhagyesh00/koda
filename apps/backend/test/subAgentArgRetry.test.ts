import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { formatArgValidationHint } from '../src/agent/prompts.js';

// Phase 6 Fix 5 — sub-agents must give the model one corrected-shape hint when
// it emits broken tool args, but not loop forever.
//
// The sub-agent's parse path uses the same `formatArgValidationHint` formatter
// as the main loop, plus a local `argHintsSeen: Set<string>` for per-shape
// dedup. This test simulates that two-step protocol on a small fake schema
// without spinning up Ollama.

const fakeReadFileSchema = z.object({
  path: z.string(),
});

/**
 * Mirror the dedup logic in subAgent.ts (lines 178-192). Pure for testing.
 */
function simulateRetryProtocol(
  attempts: Array<{ toolName: string; args: unknown }>,
  schema: z.ZodTypeAny,
): { hintsPushed: number; failuresEmitted: number; lastHint: string | null } {
  const argHintsSeen = new Set<string>();
  let hintsPushed = 0;
  let failuresEmitted = 0;
  let lastHint: string | null = null;

  for (const { toolName, args } of attempts) {
    try {
      schema.parse(args);
      // success — no failure, no hint
    } catch (err) {
      failuresEmitted += 1;
      const errMessage = err instanceof Error ? err.message : String(err);
      const shapeKey = `${toolName}:${JSON.stringify(args).slice(0, 200)}`;
      if (!argHintsSeen.has(shapeKey)) {
        argHintsSeen.add(shapeKey);
        const hint = formatArgValidationHint({
          toolName,
          args,
          error: errMessage,
          schema,
        });
        hintsPushed += 1;
        lastHint = hint;
      }
    }
  }
  return { hintsPushed, failuresEmitted, lastHint };
}

describe('subAgent arg-validation dedup protocol', () => {
  it('emits one hint for the first failure, none for an identical repeat', () => {
    const got = simulateRetryProtocol(
      [
        { toolName: 'read_file', args: { file: 'a.md' } },
        { toolName: 'read_file', args: { file: 'a.md' } },
      ],
      fakeReadFileSchema,
    );
    expect(got.failuresEmitted).toBe(2);  // both calls reported
    expect(got.hintsPushed).toBe(1);       // but only one hint
  });

  it('emits a fresh hint when the broken shape changes', () => {
    const got = simulateRetryProtocol(
      [
        { toolName: 'read_file', args: { file: 'a.md' } },     // shape A
        { toolName: 'read_file', args: { filename: 'b.md' } }, // shape B — different
      ],
      fakeReadFileSchema,
    );
    expect(got.failuresEmitted).toBe(2);
    expect(got.hintsPushed).toBe(2);
  });

  it('emits zero hints when every call is well-formed', () => {
    const got = simulateRetryProtocol(
      [
        { toolName: 'read_file', args: { path: 'a.md' } },
        { toolName: 'read_file', args: { path: 'b.md' } },
      ],
      fakeReadFileSchema,
    );
    expect(got.failuresEmitted).toBe(0);
    expect(got.hintsPushed).toBe(0);
  });

  it('produces a hint that contains both the rejected payload and a corrected example', () => {
    const got = simulateRetryProtocol(
      [{ toolName: 'read_file', args: { file: 'a.md' } }],
      fakeReadFileSchema,
    );
    expect(got.lastHint).not.toBeNull();
    expect(got.lastHint).toContain('"file": "a.md"');             // rejected
    expect(got.lastHint).toContain('"path"');                      // schema explained
    expect(got.lastHint).toContain('"name":"read_file"');          // corrected example
    expect(got.lastHint).toContain('Do NOT repeat the broken shape');
  });

  it('happy path — model recovers after one hint, second call succeeds', () => {
    const got = simulateRetryProtocol(
      [
        { toolName: 'read_file', args: { file: 'README.md' } },   // bad
        { toolName: 'read_file', args: { path: 'package.json' } }, // good
      ],
      fakeReadFileSchema,
    );
    expect(got.failuresEmitted).toBe(1);
    expect(got.hintsPushed).toBe(1);
  });
});
