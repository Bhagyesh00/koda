# Architecture

## Overview

Koda is a 3-tier system: **browser → Next.js → Express → Ollama**. Tool execution is server-side; the browser is a thin streaming client.

```
┌──────────────┐    SSE     ┌──────────────┐    HTTP    ┌────────┐
│ Next.js (FE) │ ◄────────► │ Express (BE) │ ◄────────► │ Ollama │
└──────────────┘            └──────────────┘            └────────┘
```

## Why split FE / BE?

- **Security boundary.** Filesystem and shell access live behind a token-protected API. The browser never touches the FS.
- **Streaming clarity.** SSE from Express → SSE relayed by Next.js route handler → consumed by `lib/sseClient.ts` in the React tree.
- **Scope isolation.** The agent loop is a pure Node service; the UI is purely presentational.

## The agent loop

`apps/backend/src/agent/loop.ts` is the heart. Pseudocode:

```
append user message to session
for iter in 0..MAX_ITERATIONS:
  if aborted or wall_clock_exceeded: break
  messages = system_prompt + session.messages
  emit message_start
  for delta in stream(messages):
    accumulate
    emit delta
    if complete tool_call fence detected: break early
  emit message_end
  persist assistant message (prose minus fence)
  parsed = parseToolCall(text)
  if not parsed: break        # turn complete
  tool = registry.get(parsed.name)
  args = tool.schema.parse(parsed.args)
  emit tool_request(callId, tool, args)
  if tool.requiresApproval:
    decision = await approvalQueue.request(callId)
    if denied: append denial as tool message; continue
    args = decision.args ?? args
  output = await tool.run(args, ctx)
  audit_log(...)
  append tool result to session
  emit tool_result(callId, ok, output)
emit done
```

### Caps

- `MAX_ITERATIONS = 25` tool iterations per turn
- `WALL_CLOCK_MS = 120_000` (2 minutes per turn)
- `bash`: 60s timeout, 100KB output cap
- `read_file`: 1 MB max

## Tool model

Tools implement a single interface (`apps/backend/src/tools/registry.ts`):

```ts
interface Tool<TArgs> {
  name: string;
  description: string;
  requiresApproval: boolean;
  schema: z.ZodType<TArgs>;
  run(args: TArgs, ctx: ToolContext): Promise<string>;
}
```

Schemas live in `packages/shared/src/tools.ts` so the FE can introspect them too.

## Approval flow

```
Agent loop                  Frontend
    │                          │
    │── tool_request ────────► │  (renders ToolCallCard with Approve/Deny)
    │                          │
    │                          │── POST /api/approve/:callId ─┐
    │                          │                              │
    │ ◄── approvalQueue resolves ──────────────────────────── ┘
    │
    │ run(args) → tool_result ► │
```

`approvalQueue.request(callId)` returns a Promise that resolves when the user clicks Approve/Deny. The agent loop awaits it; nothing executes until the user decides.

## Security boundaries

- **FS**: every user-supplied path goes through `sandbox/fs.ts:resolveInsideWorkDir()` which:
  1. `path.resolve(root, userPath)`
  2. lexical containment check via `path.relative`
  3. realpath check (defeats symlink escapes)
- **Shell**: `sandbox/exec.ts:runShell()` uses `execa` with `cwd: WORK_DIR_ABS`, env scrubbed to `PATH`+`HOME` only, 60s timeout, output truncated at 100KB.
- **Auth**: bearer token required on `/v1/sessions`, `/v1/chat`, `/v1/approve`. Token never leaves the Next.js server (browser hits `/api/*` proxies).
- **CORS**: allowlist single origin via `CORS_ORIGIN`.

## SSE event contract

Defined in `packages/shared/src/events.ts`:

```ts
type ServerEvent =
  | { type: 'message_start'; messageId }
  | { type: 'delta'; messageId; text }
  | { type: 'tool_request'; callId; tool; args; requiresApproval }
  | { type: 'tool_result'; callId; ok; output }
  | { type: 'todo_update'; todos }
  | { type: 'message_end'; messageId }
  | { type: 'error'; code; message }
  | { type: 'done' };
```

## Frontend architecture

- **Routing**: single-page `app/page.tsx` (App Router). Route handlers under `app/api/*` proxy to the backend, injecting the bearer token server-side.
- **State**: `zustand` store in `lib/store.ts` holds messages, todos, streaming flag, error.
- **Streaming**: `lib/sseClient.ts` POSTs to `/api/chat`, parses SSE frames, fires events into the store.
- **UI primitives**: hand-rolled (no shadcn dependency to keep the install small) — `Sidebar`, `ChatThread`, `MessageBubble`, `ToolCallCard`, `Composer`, `TodoPanel`, `MarkdownRenderer`.

## Why the fenced-JSON tool protocol?

`gemma4:e4b` (and most small open-weight models) doesn't reliably emit Ollama's native `tool_calls` field. Instead, the system prompt instructs the model to emit:

````
```tool_call
{"name": "...", "args": {...}}
```
````

…which is parsed by `agent/parser.ts`. This is robust across models and trivial to debug.
