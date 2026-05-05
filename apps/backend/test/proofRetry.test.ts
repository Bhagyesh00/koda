import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ServerEvent } from '@koda/shared';
import { runProofVerify } from '../src/agent/stages/postExecution.js';
import { sessionStore } from '../src/sessions/store.js';
import {
  _setDockerAvailableForTests,
  _resetDockerProbeForTests,
} from '../src/sandbox/exec.js';
import type { ToolCallCtx, TurnState } from '../src/agent/stages/types.js';
import type { SSEWriter } from '../src/sse.js';

// Phase 3 — Pre-Flight Simulation auto-retry mechanism.
// Verifies that a failing proof command (a) re-arms `pendingProof`, (b) queues
// a system hint for the next iteration, and (c) emits proof_result with
// willRetry=true while attempts remain.

function fakeSse(): { sse: SSEWriter; sent: ServerEvent[] } {
  const sent: ServerEvent[] = [];
  const sse: SSEWriter = {
    send(event: ServerEvent) { sent.push(event); },
    close() { /* noop */ },
    get isClosed() { return false; },
  } as unknown as SSEWriter;
  return { sse, sent };
}

function makeTurnState(): TurnState {
  return {
    pendingHypothesis: null,
    pendingProof: null,
    retryTracker: new Map(),
    proofRetries: new Map(),
    pendingHints: [],
    consecutiveFailures: 0,
    recentFailures: [],
  };
}

function makeCtx(opts: {
  sessionId: string;
  workDir: string;
  sse: SSEWriter;
  turn: TurnState;
}): ToolCallCtx {
  return {
    sessionId: opts.sessionId,
    workDir: opts.workDir,
    sse: opts.sse,
    callId: 'call-test',
    tool: { name: 'write_file', requiresApproval: true },
    parsedArgs: { path: 'x.ts', content: '// test' },
    finalArgs: { path: 'x.ts', content: '// test' },
    output: '',
    ok: true,
    turn: opts.turn,
    stageState: new Map(),
  };
}

describe('runProofVerify — Phase 3 auto-retry', () => {
  let sessionId: string;
  let workDir: string;

  beforeEach(() => {
    // Force host-fallback so the test is deterministic regardless of Docker.
    _setDockerAvailableForTests(false);
    const s = sessionStore.create({ title: 'proof-retry' });
    sessionId = s.id;
    workDir = process.cwd();
  });

  afterEach(async () => {
    sessionStore.delete(sessionId);
    await sessionStore.flush();
    _resetDockerProbeForTests();
  });

  it('re-arms pendingProof and queues a hint when proof fails with retries remaining', async () => {
    const turn = makeTurnState();
    // node -e exit 1 is portable across Windows/POSIX (Node is required to run vitest anyway).
    turn.pendingProof = { description: 'fails on purpose', command: 'node -e "process.exit(1)"' };

    const { sse, sent } = fakeSse();
    const ctx = makeCtx({ sessionId, workDir, sse, turn });

    await runProofVerify(ctx);

    const proofEvent = sent.find((e): e is Extract<ServerEvent, { type: 'proof_result' }> => e.type === 'proof_result');
    expect(proofEvent).toBeDefined();
    expect(proofEvent?.passed).toBe(false);
    expect(proofEvent?.willRetry).toBe(true);
    expect(proofEvent?.attempt).toBe(1);
    expect(proofEvent?.ranInContainer).toBe(false);

    // pendingProof must be re-armed for the next mutation to retrigger the verify.
    expect(turn.pendingProof).not.toBeNull();
    expect(turn.pendingProof?.command).toBe('node -e "process.exit(1)"');
    expect(turn.proofRetries.get('node -e "process.exit(1)"')).toBe(1);

    // A hint should have been queued for the loop's next iteration to drain.
    expect(turn.pendingHints.length).toBe(1);
    expect(turn.pendingHints[0]).toMatch(/Pre-flight verification failed/);
    expect(turn.pendingHints[0]).toMatch(/attempt 1\//);
  });

  it('stops retrying once the budget is exhausted', async () => {
    const turn = makeTurnState();
    const cmd = 'node -e "process.exit(1)"';
    turn.pendingProof = { description: 'always fails', command: cmd };
    // Pretend we already burned all but the last attempt — the next failure is terminal.
    // Default PREFLIGHT_MAX_RETRIES is 2 → max 3 attempts (1 + 2 retries). Set 2 prior fails.
    turn.proofRetries.set(cmd, 2);

    const { sse, sent } = fakeSse();
    const ctx = makeCtx({ sessionId, workDir, sse, turn });

    await runProofVerify(ctx);

    const proofEvent = sent.find((e): e is Extract<ServerEvent, { type: 'proof_result' }> => e.type === 'proof_result');
    expect(proofEvent?.passed).toBe(false);
    expect(proofEvent?.willRetry).toBe(false);
    expect(proofEvent?.attempt).toBe(3);
    expect(proofEvent?.maxAttempts).toBe(3);

    // Budget exhausted → pendingProof stays cleared, retry counter reset.
    expect(turn.pendingProof).toBeNull();
    expect(turn.proofRetries.has(cmd)).toBe(false);
    // No hint queued on the terminal failure — the agent isn't expected to retry.
    expect(turn.pendingHints.length).toBe(0);
  });

  it('clears retry counter on success', async () => {
    const turn = makeTurnState();
    const cmd = 'node -e "process.exit(0)"';
    turn.pendingProof = { description: 'passes', command: cmd };
    turn.proofRetries.set(cmd, 1);

    const { sse, sent } = fakeSse();
    const ctx = makeCtx({ sessionId, workDir, sse, turn });

    await runProofVerify(ctx);

    const proofEvent = sent.find((e): e is Extract<ServerEvent, { type: 'proof_result' }> => e.type === 'proof_result');
    expect(proofEvent?.passed).toBe(true);
    expect(turn.proofRetries.has(cmd)).toBe(false);
    expect(turn.pendingProof).toBeNull();
    expect(turn.pendingHints.length).toBe(0);
  });
});
