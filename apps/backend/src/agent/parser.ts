/**
 * Parse a tool call from assistant text.
 * Looks for ```tool_call ... ``` fenced JSON blocks.
 */
export interface ParsedToolCall {
  name: string;
  args: unknown;
  /** Index in the original text where the fence begins. */
  fenceStart: number;
  /** Index where the fence ends (exclusive). */
  fenceEnd: number;
}

const FENCE_RE = /```tool_call\s*\n([\s\S]*?)```/;

export function parseToolCall(text: string): ParsedToolCall | null {
  const match = FENCE_RE.exec(text);
  if (!match) return null;
  const json = match[1]?.trim() ?? '';
  try {
    const parsed = JSON.parse(json) as { name?: unknown; args?: unknown };
    if (typeof parsed.name !== 'string') return null;
    return {
      name: parsed.name,
      args: parsed.args ?? {},
      fenceStart: match.index,
      fenceEnd: match.index + match[0].length,
    };
  } catch {
    return null;
  }
}

/** Strip the tool_call fence from text, returning the prose part. */
export function stripToolCallFence(text: string): string {
  return text.replace(FENCE_RE, '').trim();
}
