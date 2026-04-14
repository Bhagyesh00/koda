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
import { buildSystemPrompt, buildPlanModePrompt, buildErrorHint } from './prompts.js';
import { getSkill } from '../skills/registry.js';
import { parseAllToolCalls, extractThinkingBlocks, stripThinkingBlocks } from './parser.js';
import { TOOL_DESCRIPTORS, type ApprovalDecision } from '@koda/shared';
import { zodToJsonSchemaLite } from './zodSchema.js';
import { auditLog } from '../audit/log.js';
import { usageTracker } from '../usage/tracker.js';
// ── Stage imports ─────────────────────────────────────────────────────────────
import { recallMemory, persistMemory } from './stages/memory.js';
import { runInterceptors } from './stages/interceptors.js';
import { runDriftCheck, runGuardrailsCheck, emitToolRequest, computeAndEmitBlastRadius } from './stages/preApproval.js';
import { runContextLens, runMentalModel, captureSemanticBefore } from './stages/preExecution.js';
import { runTestResults, runProofVerify, runSemanticDiffCompare, runRegretJournal, runHypothesisVerify, verifyPendingHypothesisAtTurnEnd, emitTodoUpdate, emitPlanUpdate } from './stages/postExecution.js';
import { type TurnState, type ToolCallCtx } from './stages/types.js';

const MAX_ITERATIONS = 25;
// 10 minutes — generous enough for slow local models (koda can take 600 s+ per turn).
const WALL_CLOCK_MS = 600_000;

/**
 * Hard cap on total characters across the trimmed message array.
 * ~4 chars/token → 40 000 chars ≈ 10 000 tokens, leaving headroom inside a
 * 16 384-token context window for the system prompt + new response.
 */
const MAX_CONTEXT_CHARS = 40_000;

function trimMessages(messages: OllamaMessage[]): OllamaMessage[] {
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

  // Append user message to history
  sessionStore.appendMessage(sessionId, {
    id: nanoid(8),
    role: 'user',
    content: userMessage,
    createdAt: Date.now(),
  });

  // Phase 29 — memory recall
  recallMemory(sessionId, userMessage, sse);

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
  const systemPrompt = inPlanMode
    ? buildPlanModePrompt(workDir, claudeMd)
    : buildSystemPrompt(workDir, claudeMd, activePlan, activeSkill?.promptAddition);
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
  const turnState: TurnState = { pendingHypothesis: null, pendingProof: null, retryTracker: new Map() };

  // ── Main agentic loop ───────────────────────────────────────────────────────
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (signal?.aborted) {
      sse.send({ type: 'error', code: 'aborted', message: 'cancelled' });
      break;
    }
    if (Date.now() - startedAt > WALL_CLOCK_MS) {
      sse.send({ type: 'error', code: 'timeout', message: 'turn exceeded wall-clock limit' });
      break;
    }

    const messageId = nanoid(8);
    sse.send({ type: 'message_start', messageId });
    sse.send({ type: 'activity_update', phase: 'thinking' });

    // ── LLM call ──────────────────────────────────────────────────────────────
    let assistantText = '';
    let nativeToolCalls: OllamaToolCall[] = [];
    const turnStartedAt = Date.now();
    try {
      const result = await streamOllamaChat(
        trimMessages(messages),
        (delta) => {
          assistantText += delta;
          sse.send({ type: 'delta', messageId, text: delta });
        },
        signal,
        { tools: toolDefs, model: session.model },
      );
      nativeToolCalls = result.toolCalls;
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
        id: nanoid(8),
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
      const msg = `Invalid args for ${tool.name}: ${err instanceof Error ? err.message : String(err)}`;
      sessionStore.appendMessage(sessionId, {
        id: nanoid(8),
        role: 'tool',
        content: msg,
        toolCallId: callId,
        createdAt: Date.now(),
      });
      sse.send({ type: 'tool_result', callId, ok: false, output: msg });
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
    emitToolRequest(ctx);
    computeAndEmitBlastRadius(ctx);

    // ── Approval gate (stays inline: needs tool.schema for arg re-validation) ──
    let finalArgs: unknown = parsedArgs;
    if (tool.requiresApproval && !autoApproveAll) {
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
          id: nanoid(8),
          role: 'tool',
          content: msg,
          toolCallId: callId,
          createdAt: Date.now(),
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
    try {
      output = await tool.run(finalArgs, { sessionId, workDir, signal });
    } catch (err) {
      ok = false;
      output = `Error: ${err instanceof Error ? err.message : String(err)}`;
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

    auditLog({ sessionId, tool: tool.name, callId, ok, ts: Date.now() });
    const storedOutput = truncateOutput(output);
    sessionStore.appendMessage(sessionId, {
      id: nanoid(8),
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

  // Phase 29 — persist turn to memory store
  persistMemory(sessionId, userMessage);

  sse.send({ type: 'activity_update', phase: 'idle' });
  sse.send({ type: 'done' });
  sse.close();
}
