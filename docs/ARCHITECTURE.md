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

[`apps/backend/src/agent/loop.ts`](../apps/backend/src/agent/loop.ts) is the heart. The current loop is significantly richer than the v1 sketch — it now handles guardrails, decisions, hypotheses, proofs, drift detection, semantic diffs, blast-radius analysis, mental-model tracking, regret detection, cost tracking, and cross-session memory recall. Pseudocode:

```
append user message to session
recall similar past exchanges (memory store) → emit memory_recall
for iter in 0..MAX_ITERATIONS:
  if aborted or wall_clock_exceeded: break
  emit message_start, activity_update(thinking)
  stream Ollama → emit deltas (early-break on tool fence)
  extract <think> blocks → emit thinking events
  estimate tokens → addTokens → emit cost_update (auto-pause if budget exceeded)
  emit message_end
  parse tool call from visible text
  if not parsed: break  # turn complete

  # ── Tool interception (these never reach the registry) ──
  if tool == 'hypothesis': record claim, set pendingHypothesis, continue
  if tool == 'proof':      record command, set pendingProof, continue
  if tool == 'decide':     emit decision_request, await user choice, continue

  # ── Drift & guardrails ──
  if pinnedIntent set: jaccard(intent, action); if low → emit drift_warning
  evaluate guardrails (block | warn); on block emit + skip tool

  emit tool_request(callId, tool, args)
  if tool == write_file/edit_file: computeBlastRadius → emit blast_radius
  if tool.requiresApproval: await approvalQueue.request(callId)
  capture before-content for write/edit (semantic diff)
  emit activity_update(running/writing/reading)
  output = await tool.run(args, ctx)
  emit tool_result

  # ── Post-execution side-effects ──
  if write/edit ok: compute semanticDiff → emit semantic_diff
  if write/edit ok: record edit hash; thrash check → emit regret_detected
  if read/write/edit: update mentalModel → emit mental_model_update
  if pendingProof and tool was mutating: run proof → emit proof_result
  if pendingHypothesis and tool == bash: auto-verify → emit hypothesis_update

emit activity_update(idle), done
remember(userMessage, finalAssistantText) in cross-session memory
```

### Caps

- `MAX_ITERATIONS = 25` tool iterations per turn
- `WALL_CLOCK_MS = 120_000` (2 minutes per turn)
- `bash`: 60s timeout, 100 KB output cap
- `read_file`: 1 MB max
- `THRASH_WINDOW_MS = 10 min`, `THRASH_COUNT = 3` (Regret Journal)
- Memory store keeps the last 500 exchanges
- Mental model graph capped at 50 nodes (lowest weight evicted)
- Blast radius analyzer scans up to 2000 files, skips files > 512 KB

## Backend module map

```
apps/backend/src/
├─ agent/
│   ├─ loop.ts            # Main agent loop (orchestrates everything below)
│   ├─ ollama.ts          # Streaming chat with temperature/seed override
│   ├─ parser.ts          # Fenced tool-call + <think> block parser
│   ├─ prompts.ts         # System prompt builders (build / plan modes)
│   ├─ drift.ts           # Jaccard similarity + intent drift detection (Phase 23)
│   ├─ semanticDiff.ts    # Regex-based AST-ish diff summary (Phase 25)
│   └─ blastRadius.ts     # Workspace import/reference scanner (Phase 21)
├─ approval/queue.ts      # Awaitable approval + decision queues (Phases 4, 14)
├─ audit/log.ts           # Append-only JSONL audit log
├─ guardrails/engine.ts   # Pre-execution rule evaluation (Phase 13)
├─ memory/store.ts        # Cross-session keyword recall (Phase 29)
├─ middleware/{auth,error}.ts
├─ routes/
│   ├─ health.ts
│   ├─ sessions.ts        # CRUD + branch + replay + budget + intent
│   ├─ chat.ts            # SSE chat stream
│   ├─ approval.ts        # POST /approve/:callId, POST /decide/:callId
│   ├─ plans.ts           # Plan-mode draft + approve
│   ├─ guardrails.ts      # Per-session rule CRUD
│   ├─ snapshots.ts       # git stash / file-copy snapshots (Phase 12)
│   ├─ watch.ts           # Persistent SSE for ambient file changes (Phase 15)
│   ├─ customTools.ts     # CRUD for .koda/custom-tools/*.json (Phase 17)
│   └─ peerReview.ts      # Parallel-temperature dual generation (Phase 27)
├─ sandbox/{fs,exec}.ts   # FS guard + execa wrapper
├─ sessions/store.ts      # Session persistence with all extended state
├─ tools/                 # See TOOLS.md
├─ watch/watcher.ts       # chokidar service + SSE broadcast registry
├─ sse.ts                 # SSEWriter helper
├─ server.ts              # Express bootstrap
└─ index.ts               # Entrypoint
```

## Frontend module map

```
apps/frontend/
├─ app/
│   ├─ page.tsx           # Single-page app, owns most modal/panel state
│   └─ api/               # Server-side proxies (inject AUTH_TOKEN)
│       ├─ chat/
│       ├─ sessions/[id]/{branch,replay,snapshots,budget,intent,peer-review}/
│       ├─ approve/[callId]/, decide/[callId]/
│       ├─ plans/[id]/{approve,}/
│       ├─ guardrails/[id]/[ruleId]/
│       ├─ custom-tools/[name]/
│       └─ watch/[id]/    # SSE pass-through for ambient file changes
├─ components/
│   ├─ Sidebar, ChatThread, MessageBubble, Composer, HeroHeader, TodoPanel
│   ├─ ToolCallCard       # Renders tool calls with blast radius / semantic diff / proof badges
│   ├─ MarkdownRenderer   # Code blocks with copy buttons
│   ├─ ActivityStatus, ToastContainer, ThinkingBlock
│   ├─ NewChatModal, PlanPanel, ModePill, Logo
│   │
│   │ # Phase panels & cards
│   ├─ GuardrailsPanel       # Phase 13
│   ├─ DecisionCard          # Phase 14
│   ├─ WorkspaceChangeBanner # Phase 15
│   ├─ ContextLensPanel      # Phase 16
│   ├─ CustomToolBuilder     # Phase 17
│   ├─ HypothesisLog         # Phase 19
│   ├─ SnapshotTimeline      # Phase 12
│   ├─ CostMeter             # Phase 28
│   ├─ IntentBanner          # Phase 23
│   ├─ RegretPanel           # Phase 26
│   ├─ CounterfactualModal   # Phase 22
│   ├─ MentalModelCanvas     # Phase 30
│   ├─ PeerReviewModal       # Phase 27
│   └─ MemoryRecallCard      # Phase 29
└─ lib/
    ├─ store.ts           # zustand store with all phase state slices
    ├─ sseClient.ts       # startChatStream + startWatchStream
    ├─ api.ts             # Typed API client
    ├─ thinkingParser.ts  # Strip <think> blocks during streaming
    ├─ serverFetch.ts     # Server-side helper that injects AUTH_TOKEN
    └─ cn.ts              # Tailwind class merger
```

## Sessions and persistence

Sessions live as JSON files in `<WORK_DIR>/.koda/sessions/{id}.json`. The schema is defined in [`packages/shared/src/messages.ts`](../packages/shared/src/messages.ts) and now includes:

- `messages`, `todos`, `mode`, `cwd`, `planPath` (v1 fields)
- `guardrails: GuardRule[]` — per-session rules
- `contextReads: string[]` — Context Lens entries
- `hypotheses` — pending/confirmed/refuted predictions
- `snapshots` — git stash refs or file-copy directories
- `parentId`, `branchPoint` — branch lineage
- `pinnedIntent` — Phase 23 intent freeze
- `tokenBudget`, `tokensUsed` — Phase 28 cost meter
- `editHistory` — Phase 26 thrash detection (path + content hash)
- `mentalModel` — Phase 30 file/symbol graph nodes & edges

The store backfills missing fields on load so old session files keep working.

Cross-session memory is stored separately at `<WORK_DIR>/.koda/memory.json` (last 500 exchanges across all sessions).

## SSE event contract

Defined in [`packages/shared/src/events.ts`](../packages/shared/src/events.ts). The full union as of the latest phase work:

```ts
type ServerEvent =
  // Core streaming
  | { type: 'message_start'; messageId }
  | { type: 'delta'; messageId; text }
  | { type: 'thinking'; messageId; text }
  | { type: 'message_end'; messageId }
  | {
      type: 'activity_update';
      phase: 'thinking' | 'reading' | 'writing' | 'running' | 'idle';
      tool?;
    }

  // Tool flow
  | { type: 'tool_request'; callId; tool; args; requiresApproval }
  | { type: 'tool_result'; callId; ok; output }
  | { type: 'todo_update'; todos }
  | { type: 'plan_update'; content }
  | { type: 'mode_change'; mode }
  | { type: 'error'; code; message }
  | { type: 'done' }

  // Phase 13 — Guardrails
  | { type: 'guardrail_triggered'; ruleId; action: 'block' | 'warn'; message; tool }

  // Phase 14 — Decisions
  | { type: 'decision_request'; callId; question; options }

  // Phase 15 — Ambient watch
  | { type: 'workspace_change'; files; changeType: 'modified' | 'added' | 'deleted' }

  // Phase 16 — Context Lens
  | { type: 'context_update'; files }

  // Phase 19 — Hypotheses
  | { type: 'hypothesis_update'; id; result: 'confirmed' | 'refuted' | 'pending'; actualOutcome? }

  // Phase 12 — Snapshots
  | { type: 'snapshot_created'; ref; description; ts }

  // Phase 21 — Blast radius
  | { type: 'blast_radius'; callId; importers; references; tests }

  // Phase 22 — (Counterfactual replay uses HTTP, not SSE)

  // Phase 23 — Intent drift
  | { type: 'drift_warning'; similarity; intent; action }

  // Phase 24 — Proof-carrying changes
  | { type: 'proof_result'; callId; passed; output }

  // Phase 25 — Semantic diffs
  | { type: 'semantic_diff'; path; summary; added; removed; changed }

  // Phase 26 — Regret journal
  | { type: 'regret_detected'; path; editCount; timespanMs }

  // Phase 28 — Cost meter
  | { type: 'cost_update'; turnTokens; sessionTokens; elapsedMs; budget? }

  // Phase 29 — Cross-session memory
  | { type: 'memory_recall'; matches }

  // Phase 30 — Mental model
  | { type: 'mental_model_update'; nodes; edges }

  // Phase 18 (placeholder for sub-agent orchestration)
  | { type: 'subagent_update'; agentId; status; result? };
```

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

Decision-mode (Phase 14) reuses the same primitive: `approvalQueue.requestDecision(callId)` returns a Promise that resolves when the user picks an option in `DecisionCard`.

## Security boundaries

- **FS**: every user-supplied path goes through `sandbox/fs.ts:resolveInsideWorkDir()` (resolve → lexical containment → realpath check).
- **Shell**: `sandbox/exec.ts:runShell()` uses `execa` with scrubbed env, 60 s timeout, output capped at 100 KB.
- **Auth**: bearer token required on `/v1/*` (except `/v1/health`). Token never leaves the Next.js server.
- **CORS**: single allowlisted origin via `CORS_ORIGIN`.
- **Guardrails (Phase 13)**: a per-session rule engine that runs _before_ the approval gate — blocks or warns based on path globs and command regexes.

See [`SECURITY.md`](./SECURITY.md) for details.

## Why the fenced-JSON tool protocol?

`koda` (and most small open-weight models) don't reliably emit Ollama's native `tool_calls` field. Instead, the system prompt instructs the model to emit:

````
```tool_call
{"name": "...", "args": {...}}
```
````

…parsed by `agent/parser.ts`. This is robust across models and trivial to debug.

## Why no embeddings?

Phase 23 (drift detection) and Phase 29 (cross-session memory) both use **token-level Jaccard similarity** instead of embeddings. Tradeoffs:

- **Pros**: zero new dependencies, no model loading time, deterministic, debuggable, runs in microseconds, requires no GPU.
- **Cons**: misses semantically-equivalent phrases that don't share keywords ("login" vs "auth flow").

For a local-first agent that already has 20+ phases of complexity, the tradeoff favors simplicity. If the operator wants embeddings later, both modules are encapsulated behind clean interfaces and can be swapped without touching the loop.

## Why no tree-sitter?

Phase 25 (semantic diff) and Phase 21 (blast radius) both use **regex-based extraction** instead of true AST parsing. Same reasoning: tree-sitter would add ~3 MB of WASM grammars per language and a build step. Regex catches the common cases (function declarations, imports, references) and degrades gracefully on languages we don't recognize.
