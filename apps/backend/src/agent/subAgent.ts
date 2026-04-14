import { nanoid } from 'nanoid';
import type { SSEWriter } from '../sse.js';
import { getTool } from '../tools/index.js';
import { config } from '../config.js';
import { streamOllamaChat, type OllamaMessage, type OllamaToolDef } from './ollama.js';
import { buildSystemPrompt } from './prompts.js';
import { parseAllToolCalls, stripThinkingBlocks, extractThinkingBlocks } from './parser.js';
import { getSkill } from '../skills/registry.js';
import { TOOL_DESCRIPTORS } from '@koda/shared';
import { zodToJsonSchemaLite } from './zodSchema.js';
import { logger } from '../logger.js';

/** Tools sub-agents are allowed to use (read-only only). */
const SUB_AGENT_TOOLS = new Set([
  'read_file', 'glob', 'grep', 'list_dir', 'git_status', 'git_log', 'git_diff',
  'web_fetch', 'web_search', 'web_scrape', 'db_query', 'db_list_tables',
  'db_describe_table', 'db_show_schema', 'code_metrics', 'http_request',
  'service_health', 'port_check', 'csv_query', 'json_query',
]);

export interface SubAgentTask {
  description: string;
  prompt: string;
  skill?: string;
  maxIterations?: number;
}

export interface SubAgentEvent {
  type: 'thinking' | 'delta' | 'tool_call' | 'tool_result';
  text?: string;
  tool?: string;
  args?: unknown;
  output?: string;
  ok?: boolean;
}

function buildSubAgentToolDefs(): OllamaToolDef[] {
  return TOOL_DESCRIPTORS
    .filter((t) => SUB_AGENT_TOOLS.has(t.name))
    .map((t) => {
      const schema = zodToJsonSchemaLite(t.schema) as {
        type: 'object';
        properties: Record<string, unknown>;
        required: string[];
      };
      return {
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object' as const,
            properties: schema.properties ?? {},
            required: schema.required ?? [],
          },
        },
      };
    });
}

const MAX_OUTPUT_CHARS = 4_000;

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  const head = Math.floor(MAX_OUTPUT_CHARS * 0.6);
  const tail = MAX_OUTPUT_CHARS - head;
  return `${output.slice(0, head)}\n...[truncated]...\n${output.slice(-tail)}`;
}

export async function runSubAgent(
  task: SubAgentTask,
  parentCtx: { sessionId: string; workDir: string; signal?: AbortSignal; claudeMd?: string },
  onEvent: (event: SubAgentEvent) => void,
): Promise<string> {
  const skill = task.skill ? getSkill(task.skill) : undefined;
  const systemPrompt = buildSystemPrompt(parentCtx.workDir, parentCtx.claudeMd, undefined, skill?.promptAddition);
  const toolDefs = buildSubAgentToolDefs();

  const messages: OllamaMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: task.prompt },
  ];

  const maxIter = task.maxIterations ?? 5;
  let finalText = '';

  for (let iter = 0; iter < maxIter; iter++) {
    if (parentCtx.signal?.aborted) break;

    let assistantText = '';
    let nativeToolCalls: Array<{ function: { name: string; arguments: Record<string, unknown> } }> = [];

    try {
      const result = await streamOllamaChat(
        messages,
        (delta) => {
          assistantText += delta;
          onEvent({ type: 'delta', text: delta });
        },
        parentCtx.signal,
        { tools: toolDefs },
      );
      nativeToolCalls = result.toolCalls;
    } catch (err) {
      if (parentCtx.signal?.aborted) break;
      logger.error({ err, task: task.description }, 'sub-agent LLM call failed');
      break;
    }

    // Extract thinking
    const thinkingBlocks = extractThinkingBlocks(assistantText);
    for (const block of thinkingBlocks) {
      onEvent({ type: 'thinking', text: block });
    }

    // Resolve tool call
    const visibleText = stripThinkingBlocks(assistantText);
    const fenceCalls = nativeToolCalls.length === 0 ? parseAllToolCalls(visibleText) : [];
    const fenceCall = fenceCalls[0] ?? null;
    const toolName = nativeToolCalls[0]?.function.name ?? fenceCall?.name ?? null;
    const toolArgs = nativeToolCalls[0]?.function.arguments ?? fenceCall?.args ?? null;

    messages.push({ role: 'assistant', content: visibleText });

    if (!toolName) {
      finalText = visibleText;
      break;
    }

    // Validate tool is in allowlist
    if (!SUB_AGENT_TOOLS.has(toolName)) {
      const msg = `Sub-agent cannot use tool "${toolName}" (read-only tools only).`;
      messages.push({ role: 'tool', content: msg });
      onEvent({ type: 'tool_result', tool: toolName, ok: false, output: msg });
      continue;
    }

    const tool = getTool(toolName);
    if (!tool) {
      const msg = `Unknown tool: ${toolName}`;
      messages.push({ role: 'tool', content: msg });
      continue;
    }

    // Parse args
    let parsedArgs: unknown;
    try {
      parsedArgs = tool.schema.parse(toolArgs);
    } catch (err) {
      const msg = `Invalid args for ${toolName}: ${err instanceof Error ? err.message : String(err)}`;
      messages.push({ role: 'tool', content: msg });
      continue;
    }

    onEvent({ type: 'tool_call', tool: toolName, args: parsedArgs });

    // Execute tool
    let output: string;
    let ok = true;
    try {
      output = await tool.run(parsedArgs, {
        sessionId: parentCtx.sessionId,
        workDir: parentCtx.workDir,
        signal: parentCtx.signal,
      });
    } catch (err) {
      ok = false;
      output = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }

    const storedOutput = truncateOutput(output);
    messages.push({ role: 'tool', content: storedOutput });
    onEvent({ type: 'tool_result', tool: toolName, ok, output: storedOutput });

    if (parentCtx.signal?.aborted) break;
  }

  return finalText;
}
