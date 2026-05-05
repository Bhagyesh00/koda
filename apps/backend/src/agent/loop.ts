import { nanoid } from 'nanoid';
import path from 'node:path';
import fs from 'node:fs';
import type { SSEWriter } from '../sse.js';
import { sessionStore } from '../sessions/store.js';
import { getTool, PLAN_MODE_TOOLS } from '../tools/index.js';
import { approvalQueue } from '../approval/queue.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { streamOllamaChat, type OllamaMessage, type OllamaToolCall, type OllamaToolDef } from './ollama.js';
import { buildSystemPrompt, buildPlanModePrompt, buildErrorHint, formatArgValidationHint } from './prompts.js';
import { buildStrategyResetHint, recordToolOutcome } from './stuckDetector.js';
import { getSkill } from '../skills/registry.js';
import { parseAllToolCalls, extractThinkingBlocks, stripThinkingBlocks } from './parser.js';
import { TOOL_DESCRIPTORS, type ApprovalDecision } from '@koda/shared';
import { zodToJsonSchemaLite } from './zodSchema.js';
import { auditLog } from '../audit/log.js';
import { usageTracker } from '../usage/tracker.js';
// ── Stage imports ─────────────────────────────────────────────────────────────
import { recallMemory, persistMemory, type RecallMatch } from './stages/memory.js';
import { runSelfCorrection } from './stages/selfCorrect.js';
import { emitReasoningProof } from './stages/reasoningProof.js';
import { registerTurn, unregisterTurn } from './turnRegistry.js';
import { runInterceptors } from './stages/interceptors.js';
import { runDriftCheck, runGuardrailsCheck, emitToolRequest, computeAndEmitBlastRadius, runArchitectureCheck, runRiskTier } from './stages/preApproval.js';
import { runContextLens, runMentalModel, captureSemanticBefore } from './stages/preExecution.js';
import { runTestResults, runProofVerify, runSemanticDiffCompare, runRegretJournal, runHypothesisVerify, verifyPendingHypothesisAtTurnEnd, emitTodoUpdate, emitPlanUpdate } from './stages/postExecution.js';
import { type TurnState, type ToolCallCtx } from './stages/types.js';
import { getLangfuse, createTrace } from '../telemetry/langfuse.js';

const MAX_ITERATIONS = 25;
// 10 minutes — generous enough for slow local models (koda can take 600 s+ per turn).
const WALL_CLOCK_MS = 600_000;

/**
 * Hard cap on total characters across the trimmed message array.
 * ~4 chars/token → 40 000 chars ≈ 10 000 tokens, leaving headroom inside a
 * 16 384-token context window for the system prompt + new response.
 */
const MAX_CONTEXT_CHARS = 40_000;

export function trimMessages(messages: OllamaMessage[]): OllamaMessage[] {
  if (messages.length === 0) return messages;
  const [system, ...rest] = messages;
  let budget = MAX_CONTEXT_CHARS - (system?.content.length ?? 0);
  const kept: OllamaMessage[] = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const msg = rest[i]!;
    const cost = msg.content.length;
    if (budget - cost < 0 && kept.length >= 4) break;
    kept.unshift(msg);
    budget -= cost;
  }
  // A `tool` reply must follow an `assistant` message that contains the matching
  // `tool_calls`. If the trim window starts on a `tool` message, its parent
  // assistant has been trimmed away — Ollama then rejects the request with
  // "tool message without preceding tool_calls". Drop leading orphans.
  while (kept.length > 0 && kept[0]!.role === 'tool') {
    kept.shift();
  }
  return system ? [system, ...kept] : kept;
}

const MAX_OUTPUT_CHARS = 6_000;

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  const head = Math.floor(MAX_OUTPUT_CHARS * 0.6);
  const tail = MAX_OUTPUT_CHARS - head;
  const dropped = output.length - MAX_OUTPUT_CHARS;
  return `${output.slice(0, head)}\n\n... [${dropped} characters omitted] ...\n\n${output.slice(-tail)}`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function phaseForTool(name: string): 'reading' | 'writing' | 'running' {
  if (name === 'bash') return 'running';
  if (name === 'write_file' || name === 'edit_file') return 'writing';
  return 'reading';
}

function buildToolDefs(isAllowed: (name: string) => boolean): OllamaToolDef[] {
  return TOOL_DESCRIPTORS.filter((t) => isAllowed(t.name)).map((t) => {
    const schema = zodToJsonSchemaLite(t.schema) as {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
    return {
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties: schema.properties ?? {},
          required: schema.required ?? [],
        },
      },
    };
  });
}

export interface RunTurnOptions {
  sessionId: string;
  userMessage: string;
  sse: SSEWriter;
  signal?: AbortSignal;
  autoApproveAll?: boolean;
  showThinking?: boolean;
}

export async function runTurn(opts: RunTurnOptions): Promise<void> {
  const { sessionId, userMessage, sse, signal, autoApproveAll = false, showThinking = true } = opts;
  const session = sessionStore.get(sessionId);
  if (!session) {
    sse.send({ type: 'error', code: 'not_found', message: 'session not found' });
    sse.send({ type: 'done' });
    sse.close();
    return;
  }

  // Create a turn-scoped AbortController so the session can be cancelled externally.
  // Chain with any caller-supplied signal.
  const turnAc = new AbortController();
  if (signal) {
    signal.addEventListener('abort', () => turnAc.abort(), { once: true });
  }
  registerTurn(sessionId, turnAc);

  try {
    await runTurnInner({ sessionId, userMessage, sse, signal: turnAc.signal, autoApproveAll, showThinking });
  } finally {
    unregisterTurn(sessionId);
  }
}

async function runTurnInner(opts: RunTurnOptions): Promise<void> {
  const { sessionId, userMessage, sse, signal, autoApproveAll = false, showThinking = true } = opts;
  const session = sessionStore.get(sessionId)!;

  // Append user message to history
  sessionStore.appendMessage(sessionId, {
    id: nanoid(12),
    role: 'user',
    content: userMessage,
    createdAt: Date.now(),
  });

  // Phase 29 — memory recall; also returns matches for LLM context injection
  const memoryMatches: RecallMatch[] = await recallMemory(sessionId, userMessage, sse);

  const trace = createTrace(sessionId, userMessage);
  const startedAt = Date.now();
  const inPlanMode = session.mode === 'plan';
  const workDir = session.cwd ?? config.WORK_DIR_ABS;

  // Read CLAUDE.md from project root for per-project instructions
  let claudeMd: string | undefined;
  try {
    const claudeMdPath = path.join(workDir, 'CLAUDE.md');
    if (fs.existsSync(claudeMdPath)) {
      claudeMd = fs.readFileSync(claudeMdPath, 'utf8').slice(0, 8_000);
    }
  } catch { /* CLAUDE.md is optional */ }

  // In build mode, inject the approved plan so the agent always has it in context.
  let activePlan: string | undefined;
  if (!inPlanMode && session.planPath) {
    try { activePlan = fs.readFileSync(session.planPath, 'utf8'); } catch { /* plan may not exist */ }
  }

  const activeSkill = session.skill ? getSkill(session.skill) : undefined;
  let systemPrompt = inPlanMode
    ? buildPlanModePrompt(workDir, claudeMd)
    : buildSystemPrompt(workDir, claudeMd, activePlan, activeSkill?.promptAddition);

  // Inject relevant memories from past sessions into the system prompt (score > 0.25)
  const relevantMemories = memoryMatches.filter((m) => m.score > 0.25);
  if (relevantMemories.length > 0) {
    const MAX_EXCERPT = 600;
    const block = relevantMemories
      .map((m) => m.excerpt.slice(0, MAX_EXCERPT))
      .join('\n---\n');
    systemPrompt += `\n\n## Relevant context from past sessions\n${block}`;
  }

  // Phase 31 — inject persistent constraints (functional, security, architecture, domain, etc.)
  if (session.constraints && session.constraints.length > 0) {
    const grouped = new Map<string, string[]>();
    for (const c of session.constraints) {
      const arr = grouped.get(c.type) ?? [];
      arr.push(c.text);
      grouped.set(c.type, arr);
    }
    const parts: string[] = [];
    for (const [type, texts] of grouped) {
      parts.push(`### ${type}\n${texts.map((t) => `- ${t}`).join('\n')}`);
    }
    systemPrompt += `\n\n## Constraints (MUST honour)\n${parts.join('\n\n')}`;
  }

  // Phase 31 — inject performance budget if set
  if (session.performanceBudget) {
    const b = session.performanceBudget;
    const parts: string[] = [];
    if (b.p99LatencyMs != null) parts.push(`p99 latency ≤ ${b.p99LatencyMs}ms`);
    if (b.maxMemoryMb != null) parts.push(`max memory ≤ ${b.maxMemoryMb}MB`);
    if (b.maxIoOpsPerRequest != null) parts.push(`I/O ops per request ≤ ${b.maxIoOpsPerRequest}`);
    if (parts.length > 0) {
      systemPrompt += `\n\n## Performance budget\n${parts.map((p) => `- ${p}`).join('\n')}`;
    }
  }

  // Phase 31 — inject recent rejections so we don't repeat rejected approaches
  if (session.rejections && session.rejections.length > 0) {
    const recent = session.rejections.slice(-5);
    const block = recent.map((r) => `- "${r.rejected}" (context: ${r.context})`).join('\n');
    systemPrompt += `\n\n## User-rejected approaches (DO NOT repeat)\n${block}`;
  }

  const isToolAllowed = (name: string): boolean =>
    inPlanMode ? PLAN_MODE_TOOLS.has(name) : name !== 'plan_write';
  const toolDefs = buildToolDefs(isToolAllowed);

  // Build incremental Ollama message array (avoids O(n²) per-turn reconstruction)
  const messages: OllamaMessage[] = [
    { role: 'system', content: systemPrompt },
    ...session.messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant' | 'tool',
      content: m.content,
    })),
  ];

  // Mutable turn-level state shared across all tool calls
  const turnState: TurnState = {
    pendingHypothesis: null,
    pendingProof: null,
    retryTracker: new Map(),
    proofRetries: new Map(),
    pendingHints: [],
    consecutiveFailures: 0,
    recentFailures: [],
  };

  // ── Main agentic loop ───────────────────────────────────────────────────────
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (signal?.aborted) {
      sse.send({ type: 'turn_cancelled', sessionId });
      break;
    }
    if (Date.now() - startedAt > WALL_CLOCK_MS) {
      sse.send({ type: 'error', code: 'timeout', message: 'turn exceeded wall-clock limit' });
      break;
    }

    // Phase 3 — drain pendingHints from the previous iteration's post-execution
    // stages (proof failures, retries, etc.) so the model sees them BEFORE its
    // next response. Hints are pushed as system messages because they are
    // orchestrator commentary, not user input.
    if (turnState.pendingHints.length > 0) {
      for (const hint of turnState.pendingHints) {
        messages.push({ role: 'system', content: hint });
      }
      turnState.pendingHints = [];
    }

    const messageId = nanoid(12);
    sse.send({ type: 'message_start', messageId });
    sse.send({ type: 'activity_update', phase: 'thinking' });

    // ── LLM call ──────────────────────────────────────────────────────────────
    let assistantText = '';
    let nativeToolCalls: OllamaToolCall[] = [];
    const turnStartedAt = Date.now();
    const generation = trace?.generation({
      name: 'ollama',
      model: session.model ?? config.OLLAMA_MODEL,
      input: messages.at(-1)?.content ?? '',
    });
    try {
      const result = await streamOllamaChat(
        trimMessages(messages),
        (delta) => {
          assistantText += delta;
          sse.send({ type: 'delta', messageId, text: delta });
        },
        signal,
        {
          tools: toolDefs,
          model: session.model,
          // Phase 6 Fix 3: when the model burns through its thinking budget
          // without producing a tool call, push a "decide now" hint so the
          // next iteration knows to force forward progress.
          onThinkingBudgetExceeded: (bytes) => {
            turnState.pendingHints.push(
              `<thinking_budget_exceeded bytes="${bytes}">\n` +
              `You spent the entire thinking budget (${bytes} bytes) without ` +
              `producing a tool call or final answer. Make a decision NOW: ` +
              `either call exactly ONE tool with a tool_call fence, or reply ` +
              `in plain text. Do not start a new <think> block.\n` +
              `</thinking_budget_exceeded>`,
            );
          },
        },
      );
      nativeToolCalls = result.toolCalls;
      generation?.end({ output: assistantText });
    } catch (err) {
      const isAbort =
        (err instanceof Error && err.name === 'AbortError') || signal?.aborted;
      if (isAbort) {
        logger.debug({ messageId }, 'ollama stream aborted by client');
        sse.send({ type: 'error', code: 'aborted', message: 'cancelled' });
        sse.send({ type: 'message_end', messageId });
        break;
      }
      logger.error({ err }, 'ollama stream failed');
      sse.send({
        type: 'error',
        code: 'ollama_error',
        message: err instanceof Error ? err.message : String(err),
      });
      sse.send({ type: 'message_end', messageId });
      break;
    }

    // Extract thinking blocks — only emit to frontend when showThinking is enabled
    const thinkingBlocks = extractThinkingBlocks(assistantText);
    if (showThinking) {
      for (const block of thinkingBlocks) {
        sse.send({ type: 'thinking', messageId, text: block });
      }
    }

    // Phase 28 — Cost tracking
    const turnTokens = estimateTokens(assistantText) + estimateTokens(userMessage);
    const sessionTokens = sessionStore.addTokens(sessionId, turnTokens);
    usageTracker.record(sessionId, turnTokens, Date.now() - turnStartedAt);
    const freshForBudget = sessionStore.get(sessionId);
    sse.send({
      type: 'cost_update',
      turnTokens,
      sessionTokens,
      elapsedMs: Date.now() - turnStartedAt,
      budget: freshForBudget?.tokenBudget,
    });
    if (freshForBudget?.tokenBudget && sessionTokens >= freshForBudget.tokenBudget) {
      sse.send({
        type: 'error',
        code: 'budget_exceeded',
        message: `Token budget reached (${sessionTokens}/${freshForBudget.tokenBudget}). Adjust budget in session settings to continue.`,
      });
      sse.send({ type: 'message_end', messageId });
      break;
    }
    sse.send({ type: 'message_end', messageId });

    // Resolve tool call: prefer native Ollama tool_calls, fall back to fence parsing
    const visibleText = stripThinkingBlocks(assistantText);
    const fenceCalls = nativeToolCalls.length === 0 ? parseAllToolCalls(visibleText) : [];
    const fenceCall = fenceCalls[0] ?? null;
    const resolvedToolName = nativeToolCalls[0]?.function.name ?? fenceCall?.name ?? null;
    const resolvedToolArgs = nativeToolCalls[0]?.function.arguments ?? fenceCall?.args ?? null;

    // Persist the assistant message (even if empty, needed for multi-turn coherence)
    const assistantMsg: OllamaMessage = resolvedToolName
      ? { role: 'assistant', content: visibleText, tool_calls: nativeToolCalls.length > 0 ? nativeToolCalls : undefined }
      : { role: 'assistant', content: visibleText };
    if (visibleText.trim() || resolvedToolName) {
      sessionStore.appendMessage(sessionId, {
        id: messageId,
        role: 'assistant',
        content: visibleText,
        thinking: thinkingBlocks.length > 0 ? thinkingBlocks.join('\n\n') : undefined,
        createdAt: Date.now(),
      });
      messages.push(assistantMsg);
    }

    if (!resolvedToolName) break;

    // ── Validate tool + args (stay inline: needs full registry entry) ─────────
    const tool = getTool(resolvedToolName);
    if (!tool || !isToolAllowed(resolvedToolName)) {
      const msg = !tool
        ? `Unknown tool: ${resolvedToolName}`
        : `Tool "${resolvedToolName}" is not allowed in plan mode.`;
      sessionStore.appendMessage(sessionId, {
        id: nanoid(12),
        role: 'tool',
        content: msg,
        toolCallId: resolvedToolName,
        createdAt: Date.now(),
      });
      messages.push({ role: 'tool', content: msg });
      sse.send({ type: 'tool_result', callId: resolvedToolName, ok: false, output: msg });
      continue;
    }

    const callId = nanoid(10);
    let parsedArgs: unknown;
    try {
      parsedArgs = tool.schema.parse(resolvedToolArgs);
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      const msg = `Invalid args for ${tool.name}: ${errMessage}`;
      sessionStore.appendMessage(sessionId, {
        id: nanoid(12),
        role: 'tool',
        content: msg,
        toolCallId: callId,
        createdAt: Date.now(),
      });
      sse.send({ type: 'tool_result', callId, ok: false, output: msg });

      // Phase 6 Fix 1: push a structured hint into pendingHints so the next
      // iteration's system message tells the model exactly which keys it got
      // wrong and what shape to use. Dedup per (tool, args-shape) per turn so
      // a stubborn model can't bloat the prompt forever.
      const argHashKey = `argval:${tool.name}:${JSON.stringify(resolvedToolArgs).slice(0, 200)}`;
      const seen = turnState.retryTracker.get(argHashKey) ?? 0;
      if (seen === 0) {
        turnState.retryTracker.set(argHashKey, 1);
        turnState.pendingHints.push(
          formatArgValidationHint({
            toolName: tool.name,
            args: resolvedToolArgs,
            error: errMessage,
            schema: tool.schema,
          }),
        );
      }
      continue;
    }

    // Build the per-tool-call context object threaded through all stages
    const ctx: ToolCallCtx = {
      sessionId,
      workDir,
      sse,
      signal,
      callId,
      tool: { name: tool.name, requiresApproval: tool.requiresApproval },
      parsedArgs,
      finalArgs: parsedArgs,
      output: '',
      ok: false,
      turn: turnState,
      stageState: new Map(),
    };

    // ── Interceptors: hypothesis / proof / decide ─────────────────────────────
    if (await runInterceptors(ctx)) continue;

    // ── Pre-approval stages ───────────────────────────────────────────────────
    runDriftCheck(ctx);
    if (runGuardrailsCheck(ctx) === 'block') continue;
    if (runArchitectureCheck(ctx) === 'block') continue;
    runRiskTier(ctx); // sets ctx.riskTier and ctx.forceApproval (Phase 2)
    emitToolRequest(ctx);
    computeAndEmitBlastRadius(ctx);

    // ── Approval gate (stays inline: needs tool.schema for arg re-validation) ──
    // Expert mode auto-approves everything — user has opted into reduced friction.
    // EXCEPT a high/critical risk_tier rule (ctx.forceApproval) overrides that
    // shortcut so dangerous actions still require an explicit human go-ahead.
    let finalArgs: unknown = parsedArgs;
    const expertMode = session.mode === 'expert';
    const normallyGated = tool.requiresApproval && !autoApproveAll && !expertMode;
    if (normallyGated || ctx.forceApproval) {
      const abortPromise = signal
        ? new Promise<ApprovalDecision>((resolve) =>
          signal.addEventListener(
            'abort',
            () => { approvalQueue.cancel(callId); resolve({ action: 'deny', reason: 'aborted' }); },
            { once: true },
          ),
        )
        : null;
      const dec = abortPromise
        ? await Promise.race([approvalQueue.request(callId), abortPromise])
        : await approvalQueue.request(callId);
      if (dec.action === 'deny') {
        const msg = `User denied tool call${dec.reason ? `: ${dec.reason}` : ''}`;
        sessionStore.appendMessage(sessionId, {
          id: nanoid(12),
          role: 'tool',
          content: msg,
          toolCallId: callId,
          createdAt: Date.now(),
        });
        // Phase 31 — record rejection so future turns don't repeat it
        sessionStore.addRejection(sessionId, {
          ts: Date.now(),
          context: `${tool.name} call`,
          rejected: typeof parsedArgs === 'string' ? parsedArgs : JSON.stringify(parsedArgs).slice(0, 300),
          // Decision Ledger: pull the user's deny reason through to the ledger so
          // /v1/ledger entries explain WHY the rejection happened, not just that it did.
          reason: dec.reason,
        });
        sse.send({ type: 'tool_result', callId, ok: false, output: msg });
        continue;
      }
      if (dec.args !== undefined) {
        try {
          finalArgs = tool.schema.parse(dec.args);
        } catch (err) {
          const msg = `Invalid edited args: ${err instanceof Error ? err.message : String(err)}`;
          sse.send({ type: 'tool_result', callId, ok: false, output: msg });
          continue;
        }
      }
    }
    ctx.finalArgs = finalArgs;

    // ── Pre-execution stages ──────────────────────────────────────────────────
    runContextLens(ctx);
    runMentalModel(ctx);
    captureSemanticBefore(ctx);

    // Activity indicator
    const activityDetail = (() => {
      if (tool.name === 'bash') {
        const cmd = (finalArgs as { command?: string }).command ?? '';
        return cmd.slice(0, 60) + (cmd.length > 60 ? '…' : '');
      }
      const p = (finalArgs as { path?: string }).path;
      return p ? path.basename(p) : undefined;
    })();
    sse.send({ type: 'activity_update', phase: phaseForTool(tool.name), tool: tool.name, detail: activityDetail });

    // ── Tool execution ────────────────────────────────────────────────────────
    let output: string;
    let ok = true;
    const toolSpan = trace?.span({ name: tool.name, input: JSON.stringify(finalArgs) });
    try {
      output = await tool.run(finalArgs, { sessionId, workDir, signal, sse });
      toolSpan?.end({ output: output.slice(0, 1_000) });
    } catch (err) {
      ok = false;
      output = `Error: ${err instanceof Error ? err.message : String(err)}`;
      toolSpan?.end({ output, level: 'ERROR' });
      logger.error({ err, tool: tool.name }, 'tool execution failed');
    }
    ctx.output = output;
    ctx.ok = ok;

    // If the client aborted while the tool was running, stop here — don't
    // append partial output to history or run post-execution stages.
    if (signal?.aborted) {
      sse.send({ type: 'error', code: 'aborted', message: 'cancelled' });
      break;
    }

    // ── Error auto-resolution: inject thinking hint on failure ──────────────
    if (!ok) {
      const retryCount = (turnState.retryTracker.get(tool.name) ?? 0) + 1;
      turnState.retryTracker.set(tool.name, retryCount);
      if (retryCount <= 3) {
        const hint = buildErrorHint(tool.name, finalArgs, output, retryCount);
        messages.push({ role: 'system', content: hint });
        sse.send({ type: 'activity_update', phase: 'thinking', detail: 'analyzing error...' });
      }
    }

    // Auto-think / strategy reset: track consecutive failures across all
    // tools. Per-tool retry hints handle "same call, slightly different
    // args"; the strategy reset handles "this whole approach is broken".
    // recordToolOutcome owns the counter + rolling-window logic; we just act
    // on its boolean return.
    const shouldEmitReset = recordToolOutcome(turnState, {
      ok,
      tool: tool.name,
      errorPreview: output,
      ts: Date.now(),
    });
    if (shouldEmitReset) {
      const resetHint = buildStrategyResetHint(turnState.recentFailures);
      messages.push({ role: 'system', content: resetHint });
      sse.send({
        type: 'activity_update',
        phase: 'thinking',
        detail: `stuck after ${turnState.consecutiveFailures} failures — rethinking approach…`,
      });
    }

    auditLog({ sessionId, tool: tool.name, callId, ok, ts: Date.now() });
    const storedOutput = truncateOutput(output);
    sessionStore.appendMessage(sessionId, {
      id: nanoid(12),
      role: 'tool',
      content: storedOutput,
      toolCallId: callId,
      createdAt: Date.now(),
    });
    messages.push({ role: 'tool', content: storedOutput });
    // Send full untruncated output to the UI; context window gets the truncated version
    sse.send({ type: 'tool_result', callId, ok, output });

    // ── Post-execution stages ─────────────────────────────────────────────────
    runTestResults(ctx);
    await runProofVerify(ctx);
    runSemanticDiffCompare(ctx);
    runRegretJournal(ctx);
    await runHypothesisVerify(ctx);
    emitTodoUpdate(ctx);
    emitPlanUpdate(ctx);
  }

  // ── Turn-end cleanup ────────────────────────────────────────────────────────
  // Verify any hypothesis that was never triggered inline (no bash call this turn)
  await verifyPendingHypothesisAtTurnEnd(sessionId, workDir, turnState, sse);

  // Self-correction loop — one automatic critique pass on the final response.
  // Skip in plan mode (model already reasoning carefully) and expert mode (user wants speed).
  if (!inPlanMode && session.mode !== 'expert') {
    const model = session.model ?? config.OLLAMA_MODEL;
    const corrected = await runSelfCorrection(sessionId, messages, model, sse, signal);
    if (corrected) {
      const lastMsg = sessionStore.get(sessionId)?.messages.at(-1);
      if (lastMsg?.role === 'assistant') lastMsg.content = corrected;
    }
  }

  // Verifiable reasoning proof — HMAC-SHA256 over session+message+response
  const finalMsg = sessionStore.get(sessionId)?.messages.at(-1);
  if (finalMsg?.role === 'assistant' && finalMsg.content.trim()) {
    emitReasoningProof(sessionId, finalMsg.id, userMessage, finalMsg.content, sse);
  }

  // Phase 29 — persist turn to memory store
  persistMemory(sessionId, userMessage);

  trace?.update({ output: sessionStore.get(sessionId)?.messages.at(-1)?.content ?? '' });
  getLangfuse()?.flushAsync().catch(() => { /* non-critical */ });

  sse.send({ type: 'activity_update', phase: 'idle' });
  sse.send({ type: 'done' });
  sse.close();
}
