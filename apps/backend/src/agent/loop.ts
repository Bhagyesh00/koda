import { nanoid } from 'nanoid';
import type { SSEWriter } from '../sse.js';
import { sessionStore } from '../sessions/store.js';
import { getTool, PLAN_MODE_TOOLS } from '../tools/index.js';
import { approvalQueue } from '../approval/queue.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { streamOllamaChat, type OllamaMessage, type OllamaToolCall, type OllamaToolDef } from './ollama.js';
import { buildSystemPrompt, buildPlanModePrompt } from './prompts.js';
import { parseAllToolCalls, extractThinkingBlocks, stripThinkingBlocks } from './parser.js';
import { TOOL_DESCRIPTORS, type ApprovalDecision } from '@koda/shared';
import { zodToJsonSchemaLite } from './zodSchema.js';
import { auditLog } from '../audit/log.js';
import { evaluateGuardrails } from '../guardrails/engine.js';
import { runCommand } from '../sandbox/exec.js';
import { parseTestOutput } from '../sandbox/testParser.js';
import { jaccardSimilarity, summarizeAction, DRIFT_THRESHOLD } from './drift.js';
import { computeSemanticDiff } from './semanticDiff.js';
import { computeBlastRadius } from './blastRadius.js';
import { memoryStore } from '../memory/store.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const THRASH_WINDOW_MS = 10 * 60_000;
const THRASH_COUNT = 3;

function hashContent(file: string): string {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
  } catch {
    return 'unknown';
  }
}

const MAX_ITERATIONS = 25;
// 10 minutes — generous enough for slow local models (gemma4:e2b can take 600 s+ per turn).
const WALL_CLOCK_MS = 600_000;

/**
 * Hard cap on total characters across the trimmed message array.
 * ~4 chars/token → 40 000 chars ≈ 10 000 tokens, leaving headroom inside a
 * 16 384-token context window for the system prompt + new response.
 */
const MAX_CONTEXT_CHARS = 40_000;

/**
 * Trim the message array to stay inside MAX_CONTEXT_CHARS.
 * The system prompt (index 0) is always preserved. Recent messages are kept;
 * older ones are dropped when the budget is exceeded.
 */
function trimMessages(messages: OllamaMessage[]): OllamaMessage[] {
  if (messages.length === 0) return messages;
  const [system, ...rest] = messages;
  let budget = MAX_CONTEXT_CHARS - (system?.content.length ?? 0);
  const kept: OllamaMessage[] = [];
  // Walk newest → oldest so we always keep the most recent context.
  for (let i = rest.length - 1; i >= 0; i--) {
    const msg = rest[i]!;
    const cost = msg.content.length;
    if (budget - cost < 0 && kept.length >= 4) break; // always keep at least 4 messages
    kept.unshift(msg);
    budget -= cost;
  }
  return system ? [system, ...kept] : kept;
}

/**
 * Truncate a tool output that is too large to fit comfortably in context.
 * Keeps a head and tail window so both the beginning and end of the output
 * (most useful for stack traces and file reads) are visible.
 */
const MAX_OUTPUT_CHARS = 6_000;

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  const head = Math.floor(MAX_OUTPUT_CHARS * 0.6);
  const tail = MAX_OUTPUT_CHARS - head;
  const dropped = output.length - MAX_OUTPUT_CHARS;
  return `${output.slice(0, head)}\n\n... [${dropped} characters omitted] ...\n\n${output.slice(-tail)}`;
}

/** Rough token estimate: ~4 chars per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Read-only tools that contribute to Context Lens tracking. */
const CONTEXT_TRACKING_TOOLS = new Set(['read_file', 'glob', 'grep', 'list_dir']);

export interface RunTurnOptions {
  sessionId: string;
  userMessage: string;
  sse: SSEWriter;
  signal?: AbortSignal;
  /** When true all tool calls are auto-approved — no user confirmation required. */
  autoApproveAll?: boolean;
}

function phaseForTool(name: string): 'reading' | 'writing' | 'running' {
  if (name === 'bash') return 'running';
  if (name === 'write_file' || name === 'edit_file') return 'writing';
  return 'reading';
}

/** Build Ollama-native tool definitions from registered descriptors. */
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

export async function runTurn(opts: RunTurnOptions): Promise<void> {
  const { sessionId, userMessage, sse, signal, autoApproveAll = false } = opts;
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

  // ── MEMORY RECALL (Phase 29) ───────────────────────────────────────────
  const recalls = memoryStore.recall(userMessage, sessionId, 3);
  if (recalls.length > 0) {
    sse.send({ type: 'memory_recall', matches: recalls });
  }

  const startedAt = Date.now();
  const inPlanMode = session.mode === 'plan';
  const workDir = session.cwd ?? config.WORK_DIR_ABS;

  // Read CLAUDE.md from the project root so project-level instructions are
  // injected into every turn's system prompt automatically.
  let claudeMd: string | undefined;
  try {
    const claudeMdPath = path.join(workDir, 'CLAUDE.md');
    if (fs.existsSync(claudeMdPath)) {
      claudeMd = fs.readFileSync(claudeMdPath, 'utf8').slice(0, 8_000);
    }
  } catch { /* ignore — CLAUDE.md is optional */ }

  const systemPrompt = inPlanMode
    ? buildPlanModePrompt(workDir, claudeMd)
    : buildSystemPrompt(workDir, claudeMd);
  const isToolAllowed = (name: string): boolean =>
    inPlanMode ? PLAN_MODE_TOOLS.has(name) : name !== 'plan_write';

  // Track hypothesis pending verification: {id, verification command}
  let pendingHypothesis: { id: string; verification: string } | null = null;
  // Track proof pending verification (Phase 24): description + command
  let pendingProof: { description: string; command: string } | null = null;

  // Build Ollama-native tool definitions for this session's allowed tools.
  const toolDefs = buildToolDefs(isToolAllowed);

  // Build the Ollama message array once from the session history at turn-start,
  // then grow it incrementally inside the loop. This avoids the O(n²) full
  // reconstruction that the previous per-iteration approach caused.
  // Use role:'tool' for tool results (Ollama native tools format).
  const messages: OllamaMessage[] = [
    { role: 'system', content: systemPrompt },
    ...session.messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant' | 'tool',
      content: m.content,
    })),
  ];

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
      // AbortError = user clicked Stop or closed the tab — not a real failure.
      const isAbort =
        (err instanceof Error && err.name === 'AbortError') ||
        signal?.aborted;
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

    // Extract and emit thinking blocks
    const thinkingBlocks = extractThinkingBlocks(assistantText);
    for (const block of thinkingBlocks) {
      sse.send({ type: 'thinking', messageId, text: block });
    }

    // ── Phase 28 — Cost tracking ───────────────────────────────────────
    const turnTokens = estimateTokens(assistantText) + estimateTokens(userMessage);
    const sessionTokens = sessionStore.addTokens(sessionId, turnTokens);
    const freshForBudget = sessionStore.get(sessionId);
    sse.send({
      type: 'cost_update',
      turnTokens,
      sessionTokens,
      elapsedMs: Date.now() - turnStartedAt,
      budget: freshForBudget?.tokenBudget,
    });

    // Auto-pause if budget exceeded
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

    const visibleText = stripThinkingBlocks(assistantText);

    // Resolve the tool call: prefer Ollama native tool_calls, fall back to
    // fence-block parsing for models that don't support native tool calling.
    const fenceCalls = nativeToolCalls.length === 0 ? parseAllToolCalls(visibleText) : [];
    const fenceCall = fenceCalls[0] ?? null;
    const resolvedToolName = nativeToolCalls[0]?.function.name ?? fenceCall?.name ?? null;
    const resolvedToolArgs = nativeToolCalls[0]?.function.arguments ?? fenceCall?.args ?? null;

    // Persist the assistant turn. For native tool calls the content may be
    // empty (""), but we still want the message in the Ollama history so the
    // multi-turn conversation stays coherent.
    const assistantMsg: OllamaMessage = resolvedToolName
      ? { role: 'assistant', content: visibleText, tool_calls: nativeToolCalls.length > 0 ? nativeToolCalls : undefined }
      : { role: 'assistant', content: visibleText };

    if (visibleText.trim() || resolvedToolName) {
      sessionStore.appendMessage(sessionId, {
        id: messageId,
        role: 'assistant',
        content: visibleText,
        // Persist thinking so the ThinkingBlock can be reconstructed on reload.
        thinking: thinkingBlocks.length > 0 ? thinkingBlocks.join('\n\n') : undefined,
        createdAt: Date.now(),
      });
      // Grow the messages array incrementally (avoids O(n²) per-turn work).
      messages.push(assistantMsg);
    }

    if (!resolvedToolName) break;

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

    // ── HYPOTHESIS TOOL (intercept before approval) ──────────────────────
    if (tool.name === 'hypothesis') {
      const hyp = parsedArgs as { claim: string; verification: string; expectedOutcome: string };
      const hypId = nanoid(8);
      sessionStore.addHypothesis(sessionId, {
        id: hypId,
        claim: hyp.claim,
        verification: hyp.verification,
        expectedOutcome: hyp.expectedOutcome,
        result: 'pending',
        ts: Date.now(),
      });
      pendingHypothesis = { id: hypId, verification: hyp.verification };
      const msg = `Hypothesis recorded: "${hyp.claim}" — will verify after next bash call.`;
      sessionStore.appendMessage(sessionId, {
        id: nanoid(8),
        role: 'tool',
        content: msg,
        toolCallId: callId,
        createdAt: Date.now(),
      });
      sse.send({ type: 'tool_result', callId, ok: true, output: msg });
      continue;
    }

    // ── PROOF TOOL (intercept before approval) ────────────────────────────
    if (tool.name === 'proof') {
      const proof = parsedArgs as { description: string; command: string };
      pendingProof = { description: proof.description, command: proof.command };
      const msg = `Proof registered: "${proof.description}" — will run after next mutation.`;
      sessionStore.appendMessage(sessionId, {
        id: nanoid(8),
        role: 'tool',
        content: msg,
        toolCallId: callId,
        createdAt: Date.now(),
      });
      sse.send({ type: 'tool_result', callId, ok: true, output: msg });
      continue;
    }

    // ── DECIDE TOOL (intercept before approval) ───────────────────────────
    if (tool.name === 'decide') {
      const decision = parsedArgs as { question: string; options: Array<{ label: string; pros: string[]; cons: string[] }> };
      sse.send({
        type: 'decision_request',
        callId,
        question: decision.question,
        options: decision.options,
      });
      const choice = await approvalQueue.requestDecision(callId);
      const chosen = decision.options[choice.optionIndex];
      const msg = `User chose option ${choice.optionIndex + 1}: "${chosen?.label ?? 'unknown'}"`;
      sessionStore.appendMessage(sessionId, {
        id: nanoid(8),
        role: 'tool',
        content: msg,
        toolCallId: callId,
        createdAt: Date.now(),
      });
      sse.send({ type: 'tool_result', callId, ok: true, output: msg });
      continue;
    }

    // ── DRIFT CHECK (Phase 23) ────────────────────────────────────────────
    const freshForDrift = sessionStore.get(sessionId);
    if (freshForDrift?.pinnedIntent) {
      const actionSummary = summarizeAction(tool.name, parsedArgs);
      const similarity = jaccardSimilarity(freshForDrift.pinnedIntent, actionSummary);
      if (similarity < DRIFT_THRESHOLD) {
        sse.send({
          type: 'drift_warning',
          similarity,
          intent: freshForDrift.pinnedIntent,
          action: actionSummary.slice(0, 200),
        });
      }
    }

    // ── GUARDRAILS CHECK ──────────────────────────────────────────────────
    const fresh = sessionStore.get(sessionId);
    const guardrailResult = evaluateGuardrails(fresh?.guardrails ?? [], tool.name, parsedArgs);
    if (guardrailResult.triggered && guardrailResult.rule) {
      const rule = guardrailResult.rule;
      sse.send({
        type: 'guardrail_triggered',
        ruleId: rule.id,
        action: rule.action,
        message: rule.message,
        tool: tool.name,
      });
      if (rule.action === 'block') {
        const msg = `Guardrail blocked: ${rule.message}`;
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
      // 'warn' falls through — the event was emitted, tool still runs
    }

    sse.send({
      type: 'tool_request',
      callId,
      tool: tool.name,
      args: parsedArgs,
      requiresApproval: tool.requiresApproval,
    });

    // ── BLAST RADIUS (Phase 21) — run async, fire event when ready ─────────
    if (tool.name === 'write_file' || tool.name === 'edit_file') {
      const targetPath = (parsedArgs as { path?: string }).path;
      if (targetPath) {
        try {
          const radius = computeBlastRadius(workDir, targetPath);
          if (radius.importers.length > 0 || radius.references > 0) {
            sse.send({
              type: 'blast_radius',
              callId,
              importers: radius.importers,
              references: radius.references,
              tests: radius.tests,
            });
          }
        } catch {
          /* ignore */
        }
      }
    }

    let finalArgs: unknown = parsedArgs;
    if (tool.requiresApproval && !autoApproveAll) {
      // Race the approval against the abort signal so we don't leak the pending
      // Promise forever if the client disconnects while waiting for approval.
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

    // ── CONTEXT LENS TRACKING ─────────────────────────────────────────────
    if (CONTEXT_TRACKING_TOOLS.has(tool.name)) {
      const a = finalArgs as Record<string, unknown>;
      const tracked: string[] = [];
      if (typeof a.path === 'string') tracked.push(a.path);
      if (typeof a.pattern === 'string') tracked.push(`glob:${a.pattern}`);
      if (tracked.length) {
        sessionStore.addContextReads(sessionId, tracked);
        sse.send({ type: 'context_update', files: tracked });
      }
    }

    // ── MENTAL MODEL TRACKING (Phase 30) ──────────────────────────────────
    if (tool.name === 'read_file' || tool.name === 'write_file' || tool.name === 'edit_file') {
      const filePath = (finalArgs as { path?: string }).path;
      if (filePath) {
        sessionStore.updateMentalModel(sessionId, (model) => {
          const existing = model.nodes.find((n) => n.id === filePath);
          if (existing) {
            existing.weight += 1;
          } else {
            model.nodes.push({
              id: filePath,
              kind: 'file',
              label: filePath.split(/[\\/]/).pop() ?? filePath,
              weight: 1,
            });
          }
          // Add co-accessed edges to other files touched this turn
          for (const other of model.nodes) {
            if (other.id === filePath) continue;
            const edgeExists = model.edges.some(
              (e) => (e.from === filePath && e.to === other.id) || (e.from === other.id && e.to === filePath),
            );
            if (!edgeExists && other.weight >= 1) {
              model.edges.push({ from: filePath, to: other.id, kind: 'co-accessed' });
            }
          }
          // Keep graph size manageable
          if (model.nodes.length > 50) {
            const sorted = [...model.nodes].sort((a, b) => b.weight - a.weight);
            const keep = new Set(sorted.slice(0, 50).map((n) => n.id));
            model.nodes = model.nodes.filter((n) => keep.has(n.id));
            model.edges = model.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
          }
        });
        const s = sessionStore.get(sessionId);
        if (s?.mentalModel) {
          sse.send({
            type: 'mental_model_update',
            nodes: s.mentalModel.nodes,
            edges: s.mentalModel.edges,
          });
        }
      }
    }

    // Extract a human-readable detail: basename for file tools, truncated command for bash.
    const activityDetail = (() => {
      if (tool.name === 'bash') {
        const cmd = (finalArgs as { command?: string }).command ?? '';
        return cmd.slice(0, 60) + (cmd.length > 60 ? '…' : '');
      }
      const p = (finalArgs as { path?: string }).path;
      if (p) return path.basename(p);
      return undefined;
    })();
    sse.send({ type: 'activity_update', phase: phaseForTool(tool.name), tool: tool.name, detail: activityDetail });

    // ── Capture "before" content for Semantic Diff (Phase 25) ─────────────
    let semanticBefore: string | null = null;
    let semanticTargetPath: string | null = null;
    if (tool.name === 'write_file' || tool.name === 'edit_file') {
      const targetPath = (finalArgs as { path?: string }).path;
      if (targetPath) {
        const abs = path.isAbsolute(targetPath) ? targetPath : path.join(workDir, targetPath);
        semanticTargetPath = targetPath;
        try {
          semanticBefore = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
        } catch {
          semanticBefore = '';
        }
      }
    }

    let output: string;
    let ok = true;
    try {
      output = await tool.run(finalArgs, { sessionId, workDir });
    } catch (err) {
      ok = false;
      output = `Error: ${err instanceof Error ? err.message : String(err)}`;
      logger.error({ err, tool: tool.name }, 'tool execution failed');
    }

    auditLog({ sessionId, tool: tool.name, callId, ok, ts: Date.now() });

    // Truncate large outputs so they don't overflow the context window.
    const storedOutput = truncateOutput(output);

    sessionStore.appendMessage(sessionId, {
      id: nanoid(8),
      role: 'tool',
      content: storedOutput,
      toolCallId: callId,
      createdAt: Date.now(),
    });
    // Keep the incremental messages array in sync so the next LLM call sees
    // this tool result without rebuilding from session.messages.
    // Use role:'tool' (Ollama native tools format).
    messages.push({ role: 'tool', content: storedOutput });

    // Send the full untruncated output to the UI so the user sees everything.
    sse.send({ type: 'tool_result', callId, ok, output });

    // ── TEST RESULT PARSING (Sprint 2) ────────────────────────────────────
    if (ok && tool.name === 'bash') {
      const bashCmd = (finalArgs as { command?: string }).command ?? '';
      const testResult = parseTestOutput(bashCmd, output, '');
      if (testResult) {
        sse.send({
          type: 'test_results',
          callId,
          runner: testResult.runner,
          passed: testResult.passed,
          failed: testResult.failed,
          skipped: testResult.skipped,
          duration: testResult.duration,
          failures: testResult.failures,
        });
      }
    }

    // ── PROOF-CARRYING CHANGES (Phase 24) ─────────────────────────────────
    if (
      ok &&
      pendingProof &&
      (tool.name === 'write_file' || tool.name === 'edit_file' || tool.name === 'bash')
    ) {
      const proof = pendingProof;
      pendingProof = null;
      try {
        const verifyResult = await runCommand(proof.command, workDir, { timeoutMs: 60_000 });
        const passed = verifyResult.exitCode === 0;
        sse.send({
          type: 'proof_result',
          callId,
          passed,
          output: verifyResult.output.slice(0, 500),
        });
        if (!passed) {
          sessionStore.appendMessage(sessionId, {
            id: nanoid(8),
            role: 'tool',
            content: `Proof FAILED: "${proof.description}" — ${verifyResult.output.slice(0, 300)}`,
            toolCallId: callId,
            createdAt: Date.now(),
          });
        }
      } catch {
        /* ignore proof errors */
      }
    }

    // ── SEMANTIC DIFF (Phase 25) ──────────────────────────────────────────
    if (ok && semanticTargetPath !== null && semanticBefore !== null) {
      try {
        const abs = path.isAbsolute(semanticTargetPath)
          ? semanticTargetPath
          : path.join(workDir, semanticTargetPath);
        const after = fs.readFileSync(abs, 'utf8');
        const diff = computeSemanticDiff(semanticBefore, after);
        sse.send({
          type: 'semantic_diff',
          path: semanticTargetPath,
          summary: diff.summary,
          added: diff.added,
          removed: diff.removed,
          changed: diff.changed,
        });
      } catch {
        /* ignore semantic diff errors */
      }
    }

    // ── REGRET JOURNAL (Phase 26) ─────────────────────────────────────────
    if (ok && (tool.name === 'write_file' || tool.name === 'edit_file')) {
      const editedPath = (finalArgs as { path?: string }).path;
      if (editedPath) {
        const absPath = path.isAbsolute(editedPath) ? editedPath : path.join(workDir, editedPath);
        const contentHash = hashContent(absPath);
        sessionStore.recordEdit(sessionId, { path: editedPath, ts: Date.now(), contentHash });

        const s = sessionStore.get(sessionId);
        if (s) {
          const recentEdits = (s.editHistory ?? []).filter(
            (e) => e.path === editedPath && Date.now() - e.ts <= THRASH_WINDOW_MS,
          );
          // Detect content oscillation: same hash seen 2+ times
          const hashCounts = new Map<string, number>();
          for (const e of recentEdits) {
            hashCounts.set(e.contentHash, (hashCounts.get(e.contentHash) ?? 0) + 1);
          }
          const oscillating = Array.from(hashCounts.values()).some((c) => c >= 2);
          if (recentEdits.length >= THRASH_COUNT || oscillating) {
            sse.send({
              type: 'regret_detected',
              path: editedPath,
              editCount: recentEdits.length,
              timespanMs: THRASH_WINDOW_MS,
            });
          }
        }
      }
    }

    // ── HYPOTHESIS AUTO-VERIFY (after bash) ───────────────────────────────
    if (tool.name === 'bash' && pendingHypothesis && ok) {
      const hyp = pendingHypothesis;
      pendingHypothesis = null;
      try {
        const verifyResult = await runCommand(hyp.verification, workDir, { timeoutMs: 30_000 });
        const confirmed = verifyResult.exitCode === 0;
        sessionStore.updateHypothesis(
          sessionId,
          hyp.id,
          confirmed ? 'confirmed' : 'refuted',
          verifyResult.output.slice(0, 500),
        );
        sse.send({
          type: 'hypothesis_update',
          id: hyp.id,
          result: confirmed ? 'confirmed' : 'refuted',
          actualOutcome: verifyResult.output.slice(0, 200),
        });
      } catch {
        // verification failed to run — leave hypothesis as pending
      }
    }

    if (tool.name === 'todo_write') {
      const s = sessionStore.get(sessionId);
      if (s) sse.send({ type: 'todo_update', todos: s.todos });
    }

    if (tool.name === 'plan_write' && ok) {
      const content = (finalArgs as { content: string }).content;
      sse.send({ type: 'plan_update', content });
    }
  }

  // ── HYPOTHESIS AUTO-VERIFY (turn end) ────────────────────────────────────
  // If the hypothesis was never verified inside the loop (no bash call was
  // made this turn), run the verification now so it doesn't stay pending.
  if (pendingHypothesis) {
    const hyp = pendingHypothesis;
    pendingHypothesis = null;
    try {
      const verifyResult = await runCommand(hyp.verification, workDir, { timeoutMs: 30_000 });
      const confirmed = verifyResult.exitCode === 0;
      sessionStore.updateHypothesis(
        sessionId,
        hyp.id,
        confirmed ? 'confirmed' : 'refuted',
        verifyResult.output.slice(0, 500),
      );
      sse.send({
        type: 'hypothesis_update',
        id: hyp.id,
        result: confirmed ? 'confirmed' : 'refuted',
        actualOutcome: verifyResult.output.slice(0, 200),
      });
    } catch {
      // verification command failed to run — leave result as-is
    }
  }

  // ── MEMORY PERSIST (Phase 29) ──────────────────────────────────────────
  // Save the final assistant message paired with the initial user message
  const finalSession = sessionStore.get(sessionId);
  if (finalSession) {
    const lastAssistant = [...finalSession.messages]
      .reverse()
      .find((m) => m.role === 'assistant');
    if (lastAssistant && lastAssistant.content.trim()) {
      memoryStore.remember(sessionId, userMessage, lastAssistant.content);
    }
  }

  sse.send({ type: 'activity_update', phase: 'idle' });
  sse.send({ type: 'done' });
  sse.close();
}
