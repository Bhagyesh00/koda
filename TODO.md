# Koda — TODO

Living checklist for what shipped, what's next, and ideas worth exploring.

## Done

### Per-session working directory (Claude Code style)
- New Chat opens a modal that asks for an absolute path. Backend validates it (exists, is a directory, realpath-normalized) and returns a 400 with an inline error on bad paths.
- Each session is sandboxed to its own `cwd`. All eight tools (`read_file`, `write_file`, `edit_file`, `glob`, `grep`, `list_dir`, `bash`, plus the meta tools) honor it via `ToolContext.workDir`.
- Sidebar shows the working directory under each session row and as recent quick-pick chips in the modal.
- Sessions without a cwd still use the server-wide `WORK_DIR` for back-compat.
- Affected: `packages/shared/src/messages.ts`, `apps/backend/src/{sessions/store.ts, routes/sessions.ts, sandbox/{fs,exec}.ts, tools/*, agent/loop.ts}`, `apps/frontend/{lib/api.ts, components/{NewChatModal,Sidebar}.tsx, app/page.tsx}`.

### Duplicate-chat bug on first click
- Root cause: React StrictMode double-invoked the auto-create-on-mount effect, racing with the user's click.
- Fix: removed auto-create entirely. `app/page.tsx` now selects the most recent existing session via a ref-guarded bootstrap. New sessions only come from the explicit modal flow.

---

## Next: show the user what the agent is thinking and doing

The user already sees streamed tokens and inline tool cards, but nothing separates *reasoning* from *answer*, and there's no compact status line that says *what's happening right now*. The UI feels flat during long turns.

### Reasoning traces (`<think>...</think>`)
- [ ] Parse `<think>...</think>` blocks emitted by reasoning-tuned local models (qwen3, deepseek-r1, granite-r1) in the agent loop's delta path. Strip them from the visible answer text.
- [ ] Render them in a collapsed "Thinking" section above the assistant body, similar to Claude Code's chain-of-thought toggle.
- [ ] Persist on `ChatMessage` as a separate `thinking?: string` field so they survive reloads.
- [ ] Add a setting "Show model thinking" (default: collapsed).

### Live activity / status line
- [ ] New SSE event `activity_update`: `{ phase: 'thinking' | 'reading' | 'writing' | 'running' | 'searching', label: string }` emitted by `agent/loop.ts` between phases.
- [ ] Surface it as a one-line status above the composer: `Reading apps/backend/src/index.ts… (1.3s)`, `Running pnpm test… (4s)`, `Thinking…`.
- [ ] When idle, hide the line. When streaming with no current activity, fall back to the existing shimmer in `MessageBubble`.
- [ ] Stop button next to the status, wired into the existing `AbortController` so the user can interrupt a turn mid-stream.

### Tool-call timeline polish
- [ ] Group consecutive read-only calls (`read_file`, `list_dir`, `glob`, `grep`) into a single collapsible "Inspected N files" card to cut noise on long turns.
- [ ] Show timing per call (`read_file foo.ts — 12 ms, 4.2 KB`) and a per-turn summary footer.
- [ ] Stream `bash` stdout/stderr chunks to the card while the command runs (new `tool_progress` SSE event) instead of dumping the whole output at exit.
- [ ] After a turn, render a "this turn touched: src/foo.ts (+12, −3), src/bar.ts (+0, −8)" footer.
- [ ] Retry button on errored tool calls (re-send the same args).

---

## Pre-existing bugs

- [ ] Three `ZodDefault` variance errors blocking a clean backend typecheck:
  - `apps/backend/src/tools/editFile.ts:10`
  - `apps/backend/src/tools/grep.ts:11`
  - `apps/backend/src/tools/listDir.ts:10`
  
  Root cause: the `Tool<TArgs>` generic constrains both input and output of the schema to `TArgs`, but `ZodDefault<ZodOptional<...>>` produces `TArgs | undefined` on input. Fix by widening the generic in `apps/backend/src/tools/registry.ts` to `z.ZodType<TArgs, z.ZodTypeDef, any>` so defaulted fields stay assignable.

---

## Other improvements worth picking up

### Sessions / sidebar
- [ ] Native folder picker — replace the text input with the File System Access API where available, falling back to the input on unsupported browsers.
- [ ] Live cwd validation as the user types in `NewChatModal` (debounced `POST /v1/sessions/validate-cwd`).
- [ ] Search/filter sessions in the sidebar.
- [ ] Inline rename a session.
- [ ] Pin / favorite sessions and group them by cwd.

### Agent loop
- [ ] Token + duration counters per turn, exposed via SSE and rendered in the composer footer.
- [ ] Allow the user to edit tool args before approving — the backend already accepts `decision.args`, the UI just needs an Edit button on pending cards in `ToolCallCard.tsx`.
- [ ] Soft cancellation — when Stop is clicked, finish the current tool call before sending `done` so partial output isn't lost.

### Tools
- [ ] `apply_patch` for multi-hunk edits in one call (current `edit_file` is single-string replace only).
- [ ] `read_many` for batched reads — fewer agent round trips on inspection-heavy turns.
- [ ] `web_fetch` / `web_search` behind an opt-in setting (the "private agent" pitch should remain the default).

### Plan mode
- [ ] Diff the previous plan vs. the freshly written one in `PlanPanel.tsx` so the user can see what changed between revisions.
- [ ] Allow inline edits to the plan before clicking Approve & Build.

### Persistence / safety
- [ ] Compact session JSON files (currently growing forever) — keep the last N messages hot, archive the rest to a sidecar file.
- [ ] Audit log viewer rendering `apps/backend/src/audit/log.ts` output in a settings panel.
- [ ] Lockfile so two backend processes can't race on the same session file.

### UX polish
- [ ] Ctrl-K / Cmd-K to open the New Chat modal from anywhere.
- [ ] Toast notifications for backend errors instead of the inline red banner in `ChatThread.tsx`.
- [ ] Markdown code blocks should have a Copy button and language label.
- [ ] Dark/light theme toggle (currently dark only).
