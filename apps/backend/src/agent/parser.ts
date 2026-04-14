/**
 * Parse tool calls from assistant text.
 *
 * Supports two formats:
 * 1. ```tool_call\n{"name":...,"args":{...}}``` fenced blocks (fallback for
 *    models that don't support native Ollama tool calling).
 * 2. Plain JSON object at the start of the text (some models emit raw JSON).
 *
 * Multiple tool calls in a single message are supported — the caller decides
 * how many to process per turn.
 */
export interface ParsedToolCall {
  name: string;
  args: unknown;
  /** Index in the original text where the fence begins. */
  fenceStart: number;
  /** Index where the fence ends (exclusive). */
  fenceEnd: number;
}

// Global regex so we find ALL fence blocks in one pass.
const FENCE_RE = /```tool_call\s*\n([\s\S]*?)```/g;

/**
 * Parse ALL tool_call fence blocks from the text.
 * Returns an empty array when no valid calls are found.
 */
export function parseAllToolCalls(text: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];
  // Re-create with lastIndex reset to 0 so the function is safe to call
  // multiple times without stale regex state.
  const re = new RegExp(FENCE_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const json = match[1]?.trim() ?? '';
    try {
      const parsed = JSON.parse(json) as { name?: unknown; args?: unknown };
      if (typeof parsed.name === 'string') {
        calls.push({
          name: parsed.name,
          args: parsed.args ?? {},
          fenceStart: match.index,
          fenceEnd: match.index + match[0].length,
        });
      }
    } catch {
      // Malformed JSON inside a fence — skip this block.
    }
  }
  return calls;
}

/**
 * Parse the first tool_call fence block. Returns null when none found.
 * Kept for backwards-compat with callers that process one call at a time.
 */
export function parseToolCall(text: string): ParsedToolCall | null {
  return parseAllToolCalls(text)[0] ?? null;
}

/** Strip ALL tool_call fences from text, returning only the prose. */
export function stripToolCallFences(text: string): string {
  return text.replace(new RegExp(FENCE_RE.source, 'g'), '').trim();
}

/** @deprecated Use stripToolCallFences */
export const stripToolCallFence = stripToolCallFences;

/** Extract all <think>...</think> block contents from text. */
export function extractThinkingBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /<think>([\s\S]*?)<\/think>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) blocks.push(m[1].trim());
  }
  return blocks;
}

/** Remove all <think>...</think> blocks from text, returning the visible remainder. */
export function stripThinkingBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
