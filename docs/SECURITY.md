# Security Model

Koda runs locally and trusts the operator. The threat model assumes:

- The operator trusts the chosen Ollama model not to be actively malicious.
- Tool calls may still be incorrect or surprising — the **approval gate** and **guardrails engine** are the operator's last lines of defense.
- The Koda backend should not be exposed to the public internet.

## Boundaries enforced by the code

### 1. Filesystem sandbox

[`apps/backend/src/sandbox/fs.ts`](../apps/backend/src/sandbox/fs.ts) resolves every user-supplied path against `WORK_DIR`:

1. `path.resolve(WORK_DIR_ABS, userPath)`
2. Lexical containment via `path.relative` — reject if it starts with `..` or is absolute.
3. If the file exists, `fs.realpathSync` and re-check containment — defeats symlink escapes.

Every file tool (`read_file`, `write_file`, `edit_file`, `list_dir`) goes through this guard.

### 2. Shell sandbox

[`apps/backend/src/sandbox/exec.ts`](../apps/backend/src/sandbox/exec.ts) runs commands via `execa` with:

- `cwd: WORK_DIR_ABS` (or session-specific `cwd`)
- `extendEnv: false`, exposing only `PATH` and `HOME`
- 60 second timeout (`120_000` max if model overrides)
- Output capped at 100 KB (truncated with marker)

The shell tool **always requires user approval**.

### 3. Approval gate

`requiresApproval: true` tools (`write_file`, `edit_file`, `bash`) are paused mid-loop. The operator must explicitly approve via the UI; the agent loop awaits an `approvalQueue.request()` Promise that only resolves on a `POST /v1/approve/:callId`.

There is **no auto-approve flag** in v1.

### 4. Guardrails engine (Phase 13)

[`apps/backend/src/guardrails/engine.ts`](../apps/backend/src/guardrails/engine.ts) is a per-session rule layer that runs **before** the approval gate. Each rule has:

- `tools: string[]` — which tool names it applies to (`['*']` for all)
- `pathPattern?` — minimatch glob against `args.path`
- `commandPattern?` — regex against `args.command`
- `action: 'block' | 'warn'`
- `message` — shown to the user when triggered

A `block` rule short-circuits the tool with no approval prompt. A `warn` rule fires a `guardrail_triggered` SSE (and toast) but lets the tool proceed to the approval gate.

Default presets shipped in the UI:

- "Never delete test files" (`bash` + `rm.*\.test\.`, block)
- "Protect node_modules" (write/edit + `**/node_modules/**`, block)
- "Warn before editing config" (write/edit + `*.config.*`, warn)
- "No force commands" (`bash` + `--force|rm -rf`, warn)

Guardrails are **per session** and persist with the session JSON.

### 5. Auth + transport

- The Express backend requires `Authorization: Bearer <AUTH_TOKEN>` on all routes except `/v1/health`.
- The Next.js frontend never exposes the token to the browser. The browser hits `/api/*` route handlers, which run server-side and inject the token before forwarding to the backend.
- CORS is allowlisted to a single origin (`CORS_ORIGIN`, default `http://localhost:3000`).

### 6. Audit log

Every tool execution is appended to `<WORK_DIR>/.koda/audit.log` as a JSON line:

```json
{"sessionId":"...","tool":"bash","callId":"...","ok":true,"ts":1700000000000}
```

### 7. Token budget enforcement (Phase 28)

If a session has `tokenBudget` set, the loop hard-stops after the budget is exceeded and emits an `error` event with `code: 'budget_exceeded'`. This prevents runaway costs (in compute time) and serves as a poor man's circuit breaker against pathological loops.

### 8. Snapshot-based recovery (Phase 12)

Operators can take **workspace snapshots** at any time via the `SnapshotTimeline` panel:

- If `WORK_DIR` is a git repo: uses `git stash push --include-untracked` and records the stash ref.
- Otherwise: copies the workspace into `<WORK_DIR>/.koda/snapshots/{ref}/`, skipping `node_modules`, `.git`, `.koda`.

Restores via `git stash apply` or directory copy. Snapshots are local-only and don't sync anywhere.

## Defense in depth

A risky tool call now passes through this many checks before running:

```
agent emits fence
  → zod schema validation
  → drift check (if pinned intent set, Phase 23)
  → guardrails engine (Phase 13, may block)
  → tool_request emitted
  → blast radius computed (Phase 21, advisory)
  → user approval (always for write/edit/bash)
  → execution
  → semantic diff (Phase 25, advisory)
  → regret journal thrash check (Phase 26, advisory)
  → proof verification (Phase 24, runs registered command)
```

Any single layer can stop a bad action. Operators get to see the consequences (blast radius, semantic diff, proof result) before *and* after the change lands.

## What gets persisted to disk

| Path | Contents |
|---|---|
| `<WORK_DIR>/.koda/sessions/*.json` | Per-session state (messages, todos, guardrails, hypotheses, edit history, mental model, snapshots refs) |
| `<WORK_DIR>/.koda/memory.json` | Cross-session keyword recall index (Phase 29). Last 500 exchanges. |
| `<WORK_DIR>/.koda/snapshots/*/` | File-copy snapshots (only when not a git repo) |
| `<WORK_DIR>/.koda/custom-tools/*.json` | User-defined tool definitions (Phase 17) |
| `<WORK_DIR>/.koda/audit.log` | Append-only tool execution log |
| `<WORK_DIR>/.koda/plans/*.md` | Plan-mode drafts |

To wipe all state: `rm -rf <WORK_DIR>/.koda`.

## Known non-goals

- **No multi-tenant isolation.** Single operator, single workspace.
- **No network sandbox** for `bash`. The shell can reach the network. If you don't want that, run Koda in a VM/container.
- **No model output sanitization.** Markdown is rendered with `react-markdown`, which is XSS-safe by default (no raw HTML).
- **No proof of compromise detection.** If a malicious model has filesystem access via an approved tool, the audit log records *what* happened but not *whether it was malicious*.
- **Custom tools run shell commands as the operator.** The `CustomToolBuilder` inherits the same approval gate, but operators should treat `.koda/custom-tools/` as trusted code.

## Operating recommendations

- Bind the backend to `127.0.0.1` only (default).
- Set a strong `AUTH_TOKEN` even though it's local.
- Keep `WORK_DIR` outside your home directory if you want extra confidence (e.g. `~/koda-workspace`).
- Set per-session token budgets (Phase 28) for long-running tasks to bound runaway loops.
- Pin an intent (Phase 23) at the start of risky sessions to get drift warnings.
- Add guardrails (Phase 13) for paths or command patterns you never want touched.
- Take a snapshot (Phase 12) before any destructive task — restore is one click.
- Review the audit log periodically: `tail -f .koda/audit.log`.
