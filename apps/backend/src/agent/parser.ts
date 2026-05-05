/**
 * Parse tool calls from assistant text.
 *
 * Recognised formats (in priority order):
 *   1. \`\`\`tool_call\\n{"name":...,"args":{...}}\`\`\`  — the canonical fence we
 *      tell the model to use in the system prompt.
 *   2. Harmony-style \`<|tool_call|>{...}<|...|>\` blocks — emitted by some
 *      OSS base models (gpt-oss, Qwen channel-format) when their chat
 *      template leaks special tokens into the content stream. These look
 *      like garbage to the user and were silently failing before.
 *   3. Loose \`call:<name>{...args...}\` patterns — best-effort recovery for
 *      the malformed output the koda model produced when it confused its
 *      Harmony tokens with prose.
 *
 * Multiple tool calls in a single message are supported.
 */
export interface ParsedToolCall {
  name: string;
  args: unknown;
  /** Index in the original text where the call begins. */
  fenceStart: number;
  /** Index where the call ends (exclusive). */
  fenceEnd: number;
}

// Global regex so we find ALL fence blocks in one pass.
const FENCE_RE = /```tool_call\s*\n([\s\S]*?)```/g;

/**
 * Match the Harmony-style channel format some base models emit:
 *   <|tool_call|>{"name":"bash","args":{...}}<|/tool_call|>
 *   <|tool_call|>name=bash<|/tool_call|>{"command":"ls"}
 * We match conservatively — just the JSON-bearing variant.
 */
const HARMONY_RE = /<\|\s*tool_call\s*\|>\s*([\s\S]*?)\s*<\|\s*(?:\/?tool_call|message|end|return)\s*\|>/g;

/**
 * Loose recovery for "call:bash{...}" style emissions where the model
 * confused its tool-call tokens with prose. Captures the tool name and the
 * brace-delimited arg payload (which may itself contain \`<|...|>\` cruft we
 * scrub before JSON-parsing).
 */
const LOOSE_CALL_RE = /\bcall\s*:\s*([a-z_][a-z0-9_]{0,40})\s*(\{[\s\S]*?\})\s*(?:<\|[^|>]*\|>|$|\n\n)/gi;

/**
 * Looser variant for *stripping* call:name{...} fragments from prose. The
 * parser variant requires a trailing boundary token to avoid eating real
 * sentences that happen to start with "call:"; the stripper just needs the
 * `name{...}` shape so users don't see leaked syntax.
 */
const LOOSE_CALL_STRIP_RE = /\bcall\s*:\s*[a-z_][a-z0-9_]{0,40}\s*\{[\s\S]*?\}/gi;

/**
 * Strip Harmony-style special tokens (\`<|name|>\`) from a string.
 * Used as a pre-step before JSON-parsing recovered call payloads, and also
 * exposed via [stripSpecialTokens] for cleaning visible content.
 */
function stripHarmonyTokens(s: string): string {
  return s.replace(/<\|[^|>]*\|>/g, '');
}

/**
 * Public helper: clean Harmony special-token leakage from prose so the user
 * doesn't see `<|channel|>` / `<|tool_call|>` / `<|message|>` etc. in their chat.
 */
export function stripSpecialTokens(text: string): string {
  return stripHarmonyTokens(text);
}

/**
 * Parse ALL tool calls from the text — fence, Harmony, and loose forms.
 * Returns an empty array when no valid calls are found.
 */
export function parseAllToolCalls(text: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];

  // 1) Canonical fence
  const fenceRe = new RegExp(FENCE_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(text)) !== null) {
    const json = match[1]?.trim() ?? '';
    const parsed = tryParseToolCallJson(json);
    if (parsed) {
      calls.push({
        ...parsed,
        fenceStart: match.index,
        fenceEnd: match.index + match[0].length,
      });
    }
  }

  // 2) Harmony channel format
  const harmonyRe = new RegExp(HARMONY_RE.source, 'g');
  while ((match = harmonyRe.exec(text)) !== null) {
    const inner = stripHarmonyTokens(match[1] ?? '').trim();
    const parsed = tryParseToolCallJson(inner);
    if (parsed) {
      calls.push({
        ...parsed,
        fenceStart: match.index,
        fenceEnd: match.index + match[0].length,
      });
    }
  }

  // 3) Loose `call:name{...}` recovery — only run when the canonical/harmony
  //    forms produced nothing, to avoid double-counting valid calls that
  //    happen to contain the literal substring "call:" in a string arg.
  if (calls.length === 0) {
    const looseRe = new RegExp(LOOSE_CALL_RE.source, LOOSE_CALL_RE.flags);
    while ((match = looseRe.exec(text)) !== null) {
      const name = (match[1] ?? '').trim();
      if (!name) continue;
      const argsBlob = stripHarmonyTokens(match[2] ?? '').trim();
      const args = tryParseLooseJson(argsBlob);
      if (args !== undefined) {
        calls.push({
          name,
          args,
          fenceStart: match.index,
          fenceEnd: match.index + match[0].length,
        });
      }
    }
  }

  // Stable ordering by position in the original text.
  calls.sort((a, b) => a.fenceStart - b.fenceStart);
  return calls;
}

function tryParseToolCallJson(json: string): { name: string; args: unknown } | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { name?: unknown; args?: unknown };
    if (typeof parsed.name === 'string') {
      return { name: parsed.name, args: parsed.args ?? {} };
    }
  } catch {
    // Not valid JSON — caller can fall through to the loose path.
  }
  return null;
}

/**
 * Best-effort JSON parse for malformed Harmony-style payloads where keys may
 * be unquoted (\`{command:"ls"}\`). We only attempt the cheap fix of quoting
 * bare identifier keys; anything more exotic returns undefined.
 */
function tryParseLooseJson(blob: string): unknown {
  if (!blob.startsWith('{')) return undefined;
  // First try: maybe it's already valid.
  try { return JSON.parse(blob); } catch { /* fall through */ }
  // Second try: quote bare identifier keys.
  const repaired = blob.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
  try { return JSON.parse(repaired); } catch { return undefined; }
}

/**
 * Parse the first tool_call from any supported format. Returns null when none found.
 */
export function parseToolCall(text: string): ParsedToolCall | null {
  return parseAllToolCalls(text)[0] ?? null;
}

/**
 * Strip every recognised tool-call form (fence, Harmony, loose) AND any leftover
 * Harmony special tokens from text, returning only the prose.
 */
export function stripToolCallFences(text: string): string {
  let out = text.replace(new RegExp(FENCE_RE.source, 'g'), '');
  out = out.replace(new RegExp(HARMONY_RE.source, 'g'), '');
  // Use the looser stripping variant — the parsing regex requires trailing
  // context to avoid greedy false-positives, but for cleanup we just want any
  // `call:name{...}` fragment gone, anywhere it appears.
  out = out.replace(new RegExp(LOOSE_CALL_STRIP_RE.source, LOOSE_CALL_STRIP_RE.flags), '');
  // Final pass: strip any orphaned `<|...|>` tokens that didn't match a
  // structured pattern (the user-visible "screen dance" cruft).
  out = stripHarmonyTokens(out);
  return out.trim();
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
