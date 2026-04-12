# Sprint Plan

This document mirrors the build plan that was executed to produce the codebase.

## Sprint 0 — Foundation
- pnpm workspace, root `package.json`, `tsconfig.base.json`
- `.editorconfig`, `.prettierrc`, `.gitignore`, `.env.example`
- `packages/shared` with zod schemas (`messages`, `tools`, `events`)

**Verify:** `pnpm install` succeeds, shared package typechecks.

## Sprint 1 — Backend skeleton + Ollama streaming
- `apps/backend` Express app with config (zod), pino logger, error handler
- `agent/ollama.ts` streaming client with abort signal
- In-memory `sessionStore`
- Routes: `/v1/health`, `/v1/sessions`, `/v1/chat` (SSE)
- Bearer-token auth middleware

**Verify:** `curl -N -H "Authorization: Bearer dev-secret-change-me" -H "Content-Type: application/json" -d '{"sessionId":"<id>","message":"hi"}' http://localhost:8787/v1/chat` streams a reply.

## Sprint 2 — Frontend chat shell + streaming
- Next.js 15 App Router, Tailwind, dark theme
- Server-side proxy routes under `app/api/*` (token stays on the server)
- `lib/sseClient.ts` POST + SSE parser
- `zustand` store, `Sidebar`, `ChatThread`, `MessageBubble`, `Composer`

**Verify:** Send a message in the browser, see it stream.

## Sprint 3 — Tool registry + read-only tools + agent loop
- `tools/registry.ts`, `tools/{readFile,listDir,glob,grep}.ts`
- `sandbox/fs.ts` traversal guard + realpath check
- `agent/parser.ts` fenced-JSON tool-call parser
- `agent/loop.ts` full agentic loop (max 25 iterations, 120s wall clock)
- FE `ToolCallCard` (collapsible, args + output)

**Verify:** Ask "list files in src and grep for TODO". Tool calls render correctly.

## Sprint 4 — Approval flow + mutating tools
- `approval/queue.ts` awaitable pending-approval map
- `POST /v1/approve/:callId` route
- `tools/{writeFile,editFile,bash}.ts`
- `sandbox/exec.ts` execa wrapper with timeout, env scrub, output cap
- FE Approve/Deny buttons in `ToolCallCard`
- `audit/log.ts` append-only JSONL audit log

**Verify:** Ask Koda to create `hello.js` that prints `hi`, then run it. Both calls show approval prompts; on accept, the file is created and bash output streams back.

## Sprint 5 — Todos, polish, docs
- `tools/todoWrite.ts` updates session todos, emits `todo_update` SSE event
- `TodoPanel` component
- README, ARCHITECTURE, SPRINT_PLAN, SECURITY, TOOLS docs

**Verify:** Ask Koda to make a 3-step plan; todos render in the panel.

## Sprint 6 — Hardening (deferred / future)
- File-backed session persistence
- Rate limiting on `/v1/chat` and `/v1/approve`
- Playwright e2e tests
- GitHub Actions CI
- Multi-stage Dockerfiles + `docker-compose.yml`
- shadcn/ui migration if richer primitives become necessary
