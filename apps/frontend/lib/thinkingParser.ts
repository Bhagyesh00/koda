/** Remove all <think>...</think> blocks from text, returning the visible remainder. */
export function stripThinkingBlocks(text: string): string {
  return text
    // Closed thinking blocks
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    // Open (unclosed) thinking blocks — model finished mid-thought
    .replace(/<think>[\s\S]*$/g, '')
    // Tool-call fences are rendered as ToolCallCard separately; strip from prose
    .replace(/```tool_call[\s\S]*?```/g, '')
    // Harmony / channel-format special tokens (<|tool_call|>, <|channel|>,
    // <|message|>, etc.) leak from some OSS base models when their chat
    // template doesn't strip them. Treat them as invisible — the structured
    // content gets parsed elsewhere; here we just want clean prose.
    .replace(/<\|[^|>]*\|>/g, '')
    // Loose `call:name{...}` fragments emitted alongside leaked tokens.
    .replace(/\bcall\s*:\s*[a-z_][a-z0-9_]*\s*\{[\s\S]*?\}/gi, '')
    .trim();
}

/**
 * Streaming-aware parser. Given the cumulative assistant text so far, return:
 *  - `visible`: text outside any <think> blocks
 *  - `liveThinking`: contents of the most recent <think> block, whether it's
 *    still open (no closing </think> yet) or already closed. Empty string when
 *    no <think> has appeared yet.
 *
 * Used by the frontend to render a live "Thinking…" preview as the LLM streams.
 */
export function partitionThinking(buffer: string): { visible: string; liveThinking: string } {
  const visible = stripThinkingBlocks(buffer);
  const openIdx = buffer.lastIndexOf('<think>');
  if (openIdx === -1) return { visible, liveThinking: '' };
  const after = buffer.slice(openIdx + 7); // 7 = '<think>'.length
  const closeIdx = after.indexOf('</think>');
  const liveThinking = closeIdx === -1 ? after : after.slice(0, closeIdx);
  return { visible, liveThinking: liveThinking.trim() };
}
