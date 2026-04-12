import { nanoid } from 'nanoid';
import type { SSEWriter } from '../sse.js';
import { sessionStore } from '../sessions/store.js';
import { getTool, PLAN_MODE_TOOLS } from '../tools/index.js';
import { approvalQueue } from '../approval/queue.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { streamOllamaChat, type OllamaMessage } from './ollama.js';
import { buildSystemPrompt, buildPlanModePrompt } from './prompts.js';
import { parseToolCall } from './parser.js';
import { auditLog } from '../audit/log.js';

const MAX_ITERATIONS = 25;
const WALL_CLOCK_MS = 120_000;

export interface RunTurnOptions {
  sessionId: string;
  userMessage: string;
  sse: SSEWriter;
  signal?: AbortSignal;
}

export async function runTurn(opts: RunTurnOptions): Promise<void> {
  const { sessionId, userMessage, sse, signal } = opts;
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

  const startedAt = Date.now();
  const inPlanMode = session.mode === 'plan';
  // Per-session working directory: tools sandbox here. Falls back to the
  // server-wide WORK_DIR for sessions created before per-session cwd existed.
  const workDir = session.cwd ?? config.WORK_DIR_ABS;
  const systemPrompt = inPlanMode
    ? buildPlanModePrompt(workDir)
    : buildSystemPrompt(workDir);
  const isToolAllowed = (name: string): boolean =>
    inPlanMode ? PLAN_MODE_TOOLS.has(name) : name !== 'plan_write';

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (signal?.aborted) {
      sse.send({ type: 'error', code: 'aborted', message: 'cancelled' });
      break;
    }
    if (Date.now() - startedAt > WALL_CLOCK_MS) {
      sse.send({ type: 'error', code: 'timeout', message: 'turn exceeded wall-clock limit' });
      break;
    }

    const messages: OllamaMessage[] = [
      { role: 'system', content: systemPrompt },
      ...session.messages.map((m) => ({
        role: m.role === 'tool' ? ('user' as const) : (m.role as 'user' | 'assistant'),
        content: m.role === 'tool' ? `Tool result (${m.toolCallId ?? ''}):\n${m.content}` : m.content,
      })),
    ];

    const messageId = nanoid(8);
    sse.send({ type: 'message_start', messageId });

    let assistantText = '';
    try {
      for await (const delta of streamOllamaChat(messages, signal)) {
        assistantText += delta;
        sse.send({ type: 'delta', messageId, text: delta });
        // Early-exit on tool call fence: if we already see a complete fence, stop streaming
        if (parseToolCall(assistantText)) break;
      }
    } catch (err) {
      logger.error({ err }, 'ollama stream failed');
      sse.send({
        type: 'error',
        code: 'ollama_error',
        message: err instanceof Error ? err.message : String(err),
      });
      sse.send({ type: 'message_end', messageId });
      break;
    }

    sse.send({ type: 'message_end', messageId });

    // Persist the FULL assistant message (including any tool_call fence)
    // so the next iteration's history reflects what the model actually said.
    if (assistantText.trim()) {
      sessionStore.appendMessage(sessionId, {
        id: messageId,
        role: 'assistant',
        content: assistantText,
        createdAt: Date.now(),
      });
    }

    const toolCall = parseToolCall(assistantText);
    if (!toolCall) {
      // No tool call → turn is done
      break;
    }

    const tool = getTool(toolCall.name);
    if (!tool || !isToolAllowed(toolCall.name)) {
      const msg = !tool
        ? `Unknown tool: ${toolCall.name}`
        : `Tool "${toolCall.name}" is not allowed in plan mode. Use only: ${Array.from(PLAN_MODE_TOOLS).join(', ')}.`;
      sessionStore.appendMessage(sessionId, {
        id: nanoid(8),
        role: 'tool',
        content: msg,
        toolCallId: toolCall.name,
        createdAt: Date.now(),
      });
      sse.send({ type: 'tool_result', callId: toolCall.name, ok: false, output: msg });
      continue;
    }

    const callId = nanoid(10);
    let parsedArgs: unknown;
    try {
      parsedArgs = tool.schema.parse(toolCall.args);
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

    sse.send({
      type: 'tool_request',
      callId,
      tool: tool.name,
      args: parsedArgs,
      requiresApproval: tool.requiresApproval,
    });

    let finalArgs: unknown = parsedArgs;
    if (tool.requiresApproval) {
      const decision = await approvalQueue.request(callId);
      if (decision.action === 'deny') {
        const msg = `User denied tool call${decision.reason ? `: ${decision.reason}` : ''}`;
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
      if (decision.args !== undefined) {
        try {
          finalArgs = tool.schema.parse(decision.args);
        } catch (err) {
          const msg = `Invalid edited args: ${err instanceof Error ? err.message : String(err)}`;
          sse.send({ type: 'tool_result', callId, ok: false, output: msg });
          continue;
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

    auditLog({
      sessionId,
      tool: tool.name,
      callId,
      ok,
      ts: Date.now(),
    });

    sessionStore.appendMessage(sessionId, {
      id: nanoid(8),
      role: 'tool',
      content: output,
      toolCallId: callId,
      createdAt: Date.now(),
    });

    sse.send({ type: 'tool_result', callId, ok, output });

    // Emit todo update if the session todos changed (todo_write tool)
    if (tool.name === 'todo_write') {
      const s = sessionStore.get(sessionId);
      if (s) sse.send({ type: 'todo_update', todos: s.todos });
    }

    // Emit plan update with the freshly written content
    if (tool.name === 'plan_write' && ok) {
      const content = (finalArgs as { content: string }).content;
      sse.send({ type: 'plan_update', content });
    }
  }

  sse.send({ type: 'done' });
  sse.close();
}
