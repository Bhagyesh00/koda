import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock singleton dependencies BEFORE importing the module under test.
// Vitest hoists vi.mock() calls automatically, but explicit ordering here
// makes the intent clear.
vi.mock('../src/sessions/store.js', () => ({
  sessionStore: {
    addHypothesis: vi.fn(),
    appendMessage: vi.fn(),
    get: vi.fn(() => null),
  },
}));

vi.mock('../src/approval/queue.js', () => ({
  approvalQueue: {
    requestDecision: vi.fn().mockResolvedValue({ optionIndex: 0 }),
  },
}));

import { runInterceptors } from '../src/agent/stages/interceptors.js';
import { sessionStore } from '../src/sessions/store.js';
import { approvalQueue } from '../src/approval/queue.js';
import type { ToolCallCtx, TurnState } from '../src/agent/stages/types.js';

// ── helpers ───────────────────────────────────────────────────────────────────

type SseSpy = { send: ReturnType<typeof vi.fn>; events: unknown[] };

function makeSse(): SseSpy {
  const events: unknown[] = [];
  return { send: vi.fn((e: unknown) => events.push(e)), events };
}

function makeTurn(): TurnState {
  return { pendingHypothesis: null, pendingProof: null };
}

function makeCtx(overrides: Partial<ToolCallCtx> = {}): ToolCallCtx {
  const turn = overrides.turn ?? makeTurn();
  const sse = overrides.sse ?? (makeSse() as unknown as ToolCallCtx['sse']);
  return {
    sessionId: 'sess-1',
    workDir: '/workspace',
    sse,
    callId: 'call-1',
    tool: { name: 'read_file', requiresApproval: false },
    parsedArgs: {},
    finalArgs: {},
    output: '',
    ok: false,
    turn,
    stageState: new Map(),
    ...overrides,
  };
}

function eventsOf(ctx: ToolCallCtx): unknown[] {
  return (ctx.sse as unknown as SseSpy).events;
}

function eventTypes(ctx: ToolCallCtx): string[] {
  return eventsOf(ctx).map((e) => (e as { type: string }).type);
}

// ── runInterceptors ───────────────────────────────────────────────────────────

describe('runInterceptors — pass-through', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns false for non-intercepted tools', async () => {
    for (const name of ['read_file', 'write_file', 'bash', 'glob', 'grep']) {
      const ctx = makeCtx({ tool: { name, requiresApproval: false } });
      expect(await runInterceptors(ctx)).toBe(false);
    }
  });

  it('does not emit SSE events for non-intercepted tools', async () => {
    const ctx = makeCtx({ tool: { name: 'bash', requiresApproval: false } });
    await runInterceptors(ctx);
    expect(eventsOf(ctx)).toHaveLength(0);
  });
});

describe('runInterceptors — hypothesis', () => {
  beforeEach(() => vi.clearAllMocks());

  const args = { claim: 'X compiles', verification: 'tsc --noEmit', expectedOutcome: 'exit 0' };

  it('returns true (intercept)', async () => {
    const ctx = makeCtx({
      tool: { name: 'hypothesis', requiresApproval: false },
      parsedArgs: args,
    });
    expect(await runInterceptors(ctx)).toBe(true);
  });

  it('sets turn.pendingHypothesis with verification command', async () => {
    const turn = makeTurn();
    const ctx = makeCtx({
      tool: { name: 'hypothesis', requiresApproval: false },
      parsedArgs: args,
      turn,
    });
    await runInterceptors(ctx);
    expect(turn.pendingHypothesis).not.toBeNull();
    expect(turn.pendingHypothesis?.verification).toBe('tsc --noEmit');
  });

  it('emits exactly one tool_result event', async () => {
    const sse = makeSse();
    const ctx = makeCtx({
      tool: { name: 'hypothesis', requiresApproval: false },
      parsedArgs: args,
      sse: sse as unknown as ToolCallCtx['sse'],
    });
    await runInterceptors(ctx);
    const results = sse.events.filter((e) => (e as { type: string }).type === 'tool_result');
    expect(results).toHaveLength(1);
    expect((results[0] as { ok: boolean }).ok).toBe(true);
  });

  it('calls sessionStore.addHypothesis once', async () => {
    const ctx = makeCtx({
      tool: { name: 'hypothesis', requiresApproval: false },
      parsedArgs: args,
    });
    await runInterceptors(ctx);
    expect(sessionStore.addHypothesis).toHaveBeenCalledOnce();
  });

  it('calls sessionStore.appendMessage once', async () => {
    const ctx = makeCtx({
      tool: { name: 'hypothesis', requiresApproval: false },
      parsedArgs: args,
    });
    await runInterceptors(ctx);
    expect(sessionStore.appendMessage).toHaveBeenCalledOnce();
  });
});

describe('runInterceptors — proof', () => {
  beforeEach(() => vi.clearAllMocks());

  const args = { description: 'Tests pass', command: 'npm test' };

  it('returns true (intercept)', async () => {
    const ctx = makeCtx({
      tool: { name: 'proof', requiresApproval: false },
      parsedArgs: args,
    });
    expect(await runInterceptors(ctx)).toBe(true);
  });

  it('sets turn.pendingProof', async () => {
    const turn = makeTurn();
    const ctx = makeCtx({
      tool: { name: 'proof', requiresApproval: false },
      parsedArgs: args,
      turn,
    });
    await runInterceptors(ctx);
    expect(turn.pendingProof).not.toBeNull();
    expect(turn.pendingProof?.command).toBe('npm test');
    expect(turn.pendingProof?.description).toBe('Tests pass');
  });

  it('emits one tool_result with ok=true', async () => {
    const sse = makeSse();
    const ctx = makeCtx({
      tool: { name: 'proof', requiresApproval: false },
      parsedArgs: args,
      sse: sse as unknown as ToolCallCtx['sse'],
    });
    await runInterceptors(ctx);
    const results = sse.events.filter((e) => (e as { type: string }).type === 'tool_result');
    expect(results).toHaveLength(1);
    expect((results[0] as { ok: boolean }).ok).toBe(true);
  });
});

describe('runInterceptors — decide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(approvalQueue.requestDecision).mockResolvedValue({ optionIndex: 1 });
  });

  const options = [
    { label: 'Option A', pros: ['fast'], cons: ['risky'] },
    { label: 'Option B', pros: ['safe'], cons: ['slow'] },
  ];
  const args = { question: 'Which approach?', options };

  it('returns true (intercept)', async () => {
    const ctx = makeCtx({
      tool: { name: 'decide', requiresApproval: false },
      parsedArgs: args,
    });
    expect(await runInterceptors(ctx)).toBe(true);
  });

  it('emits decision_request before tool_result', async () => {
    const sse = makeSse();
    const ctx = makeCtx({
      tool: { name: 'decide', requiresApproval: false },
      parsedArgs: args,
      sse: sse as unknown as ToolCallCtx['sse'],
    });
    await runInterceptors(ctx);
    const types = sse.events.map((e) => (e as { type: string }).type);
    expect(types.indexOf('decision_request')).toBeLessThan(types.indexOf('tool_result'));
  });

  it('decision_request carries the question and options', async () => {
    const sse = makeSse();
    const ctx = makeCtx({
      tool: { name: 'decide', requiresApproval: false },
      parsedArgs: args,
      sse: sse as unknown as ToolCallCtx['sse'],
    });
    await runInterceptors(ctx);
    const req = sse.events.find((e) => (e as { type: string }).type === 'decision_request') as {
      question: string;
      options: typeof options;
    };
    expect(req.question).toBe('Which approach?');
    expect(req.options).toHaveLength(2);
  });

  it('tool_result message reflects the chosen option label', async () => {
    const sse = makeSse();
    const ctx = makeCtx({
      tool: { name: 'decide', requiresApproval: false },
      parsedArgs: args,
      sse: sse as unknown as ToolCallCtx['sse'],
    });
    await runInterceptors(ctx);
    const result = sse.events.find(
      (e) => (e as { type: string }).type === 'tool_result',
    ) as { output: string };
    // optionIndex 1 → "Option B"
    expect(result.output).toContain('Option B');
  });

  it('calls approvalQueue.requestDecision with the callId', async () => {
    const ctx = makeCtx({
      tool: { name: 'decide', requiresApproval: false },
      parsedArgs: args,
      callId: 'decide-call-99',
    });
    await runInterceptors(ctx);
    expect(approvalQueue.requestDecision).toHaveBeenCalledWith('decide-call-99');
  });
});
