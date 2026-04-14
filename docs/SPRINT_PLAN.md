# Sprint Plan

This document tracks the build plan that was executed to produce the codebase. Sprints 0–5 are the original v1 (chat + tools + approval). Phases 11–30 are the post-v1 expansion that turned Koda into a Claude-Code-class agent with several novel features.

---

## v1 — Foundation

### Sprint 0 — Foundation
- pnpm workspace, root `package.json`, `tsconfig.base.json`
- `.editorconfig`, `.prettierrc`, `.gitignore`, `.env.example`
- `packages/shared` with zod schemas (`messages`, `tools`, `events`)

**Verify:** `pnpm install` succeeds, shared package typechecks.

### Sprint 1 — Backend skeleton + Ollama streaming
- `apps/backend` Express app with config (zod), pino logger, error handler
- `agent/ollama.ts` streaming client with abort signal
- File-backed `sessionStore`
- Routes: `/v1/health`, `/v1/sessions`, `/v1/chat` (SSE)
- Bearer-token auth middleware

**Verify:** `curl -N -H "Authorization: Bearer dev-secret-change-me" -H "Content-Type: application/json" -d '{"sessionId":"<id>","message":"hi"}' http://localhost:8787/v1/chat` streams a reply.

### Sprint 2 — Frontend chat shell + streaming
- Next.js 15 App Router, Tailwind, dark theme
- Server-side proxy routes under `app/api/*` (token stays on the server)
- `lib/sseClient.ts` POST + SSE parser
- `zustand` store, `Sidebar`, `ChatThread`, `MessageBubble`, `Composer`

**Verify:** Send a message in the browser, see it stream.

### Sprint 3 — Tool registry + read-only tools + agent loop
- `tools/registry.ts`, `tools/{readFile,listDir,glob,grep}.ts`
- `sandbox/fs.ts` traversal guard + realpath check
- `agent/parser.ts` fenced-JSON tool-call parser
- `agent/loop.ts` full agentic loop (max 25 iterations, 120 s wall clock)
- FE `ToolCallCard` (collapsible, args + output)

**Verify:** Ask "list files in src and grep for TODO". Tool calls render correctly.

### Sprint 4 — Approval flow + mutating tools
- `approval/queue.ts` awaitable pending-approval map
- `POST /v1/approve/:callId` route
- `tools/{writeFile,editFile,bash}.ts`
- `sandbox/exec.ts` execa wrapper with timeout, env scrub, output cap
- FE Approve/Deny buttons in `ToolCallCard`
- `audit/log.ts` append-only JSONL audit log

**Verify:** Ask Koda to create `hello.js` that prints `hi`, then run it. Both calls show approval prompts; on accept, the file is created and bash output streams back.

### Sprint 5 — Todos, polish, docs
- `tools/todoWrite.ts` updates session todos, emits `todo_update` SSE event
- `TodoPanel` component
- README, ARCHITECTURE, SPRINT_PLAN, SECURITY, TOOLS docs

**Verify:** Ask Koda to make a 3-step plan; todos render in the panel.

---

## Pre-phase fixes

- Fixed `Tool<TArgs>` generic to use `z.ZodType<TArgs, z.ZodTypeDef, any>` so tools with `.optional().default()` fields type-check
- Added explicit `: Router` type annotations to all route exports (TS2742)
- Added `runCommand` convenience wrapper to `sandbox/exec.ts`
- Installed `chokidar` (Phase 15) and `minimatch` (Phase 13)

---

## v2 — Claude-Code-class features

### Phase 1 — Reasoning traces & activity status
- `<think>` block extraction in `parser.ts`
- `thinking` SSE event + `ThinkingBlock` component
- `activity_update` SSE + `ActivityStatus` component (idle/thinking/reading/writing/running)
- Strip `<think>` from streaming display

### Phase 2 — Session UX polish
- Session rename (PATCH `/sessions/:id`, inline pencil edit in `Sidebar`)
- Session search (filter input)
- Toast notifications (`addToast` store action + `ToastContainer`)
- Code block copy buttons in `MarkdownRenderer`
- Turn duration counter on assistant messages
- `Ctrl+K` shortcut to open new chat
- Silent abort (don't show error banner on user-initiated stop)

### Phase 11 — Session branching
- Backend `POST /sessions/:id/branch` route — copies messages up to a point, inherits guardrails and `cwd`
- `branchSession` API client
- GitBranch icon in Sidebar (visible on hover) + GitBranch icon for branched sessions

### Phase 12 — Workspace snapshots & time travel
- `snapshots.ts` route — git stash if `.git` exists, otherwise file copy under `.koda/snapshots/`
- `SnapshotTimeline` panel with create input + restore button per snapshot
- Camera icon in `HeroHeader`

### Phase 13 — Guardrails engine
- `guardrails/engine.ts` with minimatch + regex evaluation
- Per-session `GuardRule[]` persisted with the session
- `GuardrailsPanel` with rule CRUD + 4 presets
- `guardrail_triggered` SSE event handled as toast

### Phase 14 — Structured decision mode
- New `decide` tool intercepted by the loop
- `approvalQueue.requestDecision()` Promise-based pause
- `decision_request` SSE → `DecisionCard` rendered inline in `ChatThread`
- `POST /v1/decide/:callId` resolves the decision

### Phase 15 — Ambient watch mode
- `watch/watcher.ts` chokidar service with per-session SSE broadcast registry
- `GET /v1/sessions/:id/watch` persistent SSE endpoint
- Frontend `startWatchStream` opens a long-lived SSE connection per session
- `WorkspaceChangeBanner` shows recent file changes with dismiss

### Phase 16 — Context Lens
- `addContextReads` tracks files seen by `read_file`/`glob`/`grep`/`list_dir`
- `context_update` SSE event
- `ContextLensPanel` lists files and globs the agent has touched

### Phase 17 — Custom tool builder
- `tools/customLoader.ts` loads `.koda/custom-tools/*.json` at startup
- Generated zod schema from arg definitions
- Shell template interpolation with `{arg_name}` placeholders
- `routes/customTools.ts` CRUD endpoints
- `CustomToolBuilder` modal UI with editor

### Phase 19 — Hypothesis engine
- New `hypothesis` tool intercepted by the loop
- `pendingHypothesis` flag; auto-runs verification after next bash
- `hypothesis_update` SSE event
- `HypothesisLog` panel with confirmed/refuted/pending stats

### Phase 18 — Multi-agent orchestration *(future)*
- Placeholder `subagent_update` SSE event reserved
- Not yet implemented — would require parallel session spawning

### Phase 20 — Live collaboration *(future)*
- Reserved for observer SSE fan-out

---

## v3 — Creative phases (10 novel features)

### Phase 21 — Blast radius preview
- `agent/blastRadius.ts` walks up to 2000 workspace files, finds importers + symbol references + test files
- Emits `blast_radius` SSE before `write_file`/`edit_file` approval
- Rendered as Impact section in `ToolCallCard`

### Phase 22 — Counterfactual replay
- `POST /sessions/:id/replay` finds tool result by `callId`, forks session with that result replaced
- `CounterfactualModal` lets the user edit the tool output and create the alternate timeline
- Rewind button on every completed `ToolCallCard`

### Phase 23 — Intent freeze + drift detection
- `agent/drift.ts` Jaccard similarity over tokenized intent vs proposed action
- `pinnedIntent` stored on session; `PUT /sessions/:id/intent` setter
- `drift_warning` SSE when similarity falls below threshold (0.08)
- `IntentBanner` at top of chat with pin/edit/unpin

### Phase 24 — Proof-carrying changes
- New `proof` tool intercepted by the loop
- `pendingProof` runs automatically after the next mutating tool (write/edit/bash)
- `proof_result` SSE with pass/fail + output
- Proof badge in `ToolCallCard`

### Phase 25 — Semantic diff review
- `agent/semanticDiff.ts` regex-based symbol extraction → NL summary like "+2 functions, -1 import"
- Captured before/after content around write/edit calls
- `semantic_diff` SSE rendered inline in `ToolCallCard`

### Phase 26 — Regret journal
- `editHistory` tracks (path, ts, contentHash) per session
- Detects thrash: ≥3 edits in 10 min OR same hash seen twice
- `regret_detected` SSE → `RegretPanel` with editCount + timespan

### Phase 27 — Peer review mode
- Extended `streamOllamaChat` to accept temperature/seed overrides
- `POST /sessions/:id/peer-review` runs two parallel generations at temp 0.2 and 0.8
- `PeerReviewModal` split-screen diff with copy buttons

### Phase 28 — Live cost + budget meter
- Token estimation (chars/4) per turn in the loop
- `addTokens` accumulator on session
- `cost_update` SSE with turn + session totals
- `tokenBudget` enforces hard pause via `error: budget_exceeded`
- `CostMeter` in `HeroHeader` with progress bar + editable budget

### Phase 29 — Cross-session semantic memory
- `memory/store.ts` keyword (Jaccard) recall over `.koda/memory.json`
- Recalls top-3 similar past exchanges from *other* sessions on each user message
- `memory_recall` SSE → `MemoryRecallCard` collapsible at top of chat thread
- Persists `(userMessage, finalAssistantText)` after each turn

### Phase 30 — Mental model visualizer
- Loop tracks file access weights + co-accessed edges per turn
- `mental_model_update` SSE with nodes/edges
- `MentalModelCanvas` renders SVG radial layout (heaviest at center)
- Network icon in `HeroHeader` with node count badge

---

## Verification across all phases

After every phase pair the workspace must pass:

```bash
pnpm typecheck   # 0 errors across shared / backend / frontend
pnpm test        # all existing tests still pass
```

Manual smoke flow that exercises most phases:

1. Start: `make dev`
2. Pin intent: "Add a /health endpoint"
3. Enable a guardrail: "Protect node_modules"
4. Set a budget: 10k tokens
5. Ask Koda to add the endpoint with `proof: pnpm test`
6. Watch the activity status, blast radius, semantic diff, proof result
7. Take a snapshot before, restore after
8. Open Mental Model canvas — verify the touched files appear
9. Branch the session and try a different approach in the branch

---

## Known deferred work

- **Phase 18** — Multi-agent orchestration (parallel sub-agents)
- **Phase 20** — Live collaboration (observer SSE fan-out)
- **Embeddings backend** for drift / memory (currently Jaccard-only)
- **Tree-sitter integration** for semantic diff / blast radius (currently regex-only)
- **Per-session pre-execution sandbox** — running `bash` inside a Docker container by default
- **CI / Playwright e2e tests**
- **Multi-stage Dockerfiles + `docker-compose.yml`**
