# Security Model

Koda runs locally and trusts the operator. The threat model assumes:

- The operator trusts the chosen Ollama model not to be actively malicious.
- Tool calls may still be incorrect or surprising — the **approval gate** is the operator's last line of defense.
- The Koda backend should not be exposed to the public internet.

## Boundaries enforced by the code

### 1. Filesystem sandbox

`apps/backend/src/sandbox/fs.ts` resolves every user-supplied path against `WORK_DIR`:

1. `path.resolve(WORK_DIR_ABS, userPath)`
2. Lexical containment via `path.relative` — reject if it starts with `..` or is absolute.
3. If the file exists, `fs.realpathSync` and re-check containment — defeats symlink escapes.

Every file tool (`read_file`, `write_file`, `edit_file`, `list_dir`) goes through this guard.

### 2. Shell sandbox

`apps/backend/src/sandbox/exec.ts` runs commands via `execa` with:

- `cwd: WORK_DIR_ABS`
- `extendEnv: false`, exposing only `PATH` and `HOME`
- 60 second timeout (`120_000` max if model overrides)
- Output capped at 100 KB (truncated with marker)

The shell tool **always requires user approval**.

### 3. Approval gate

`requiresApproval: true` tools (`write_file`, `edit_file`, `bash`) are paused mid-loop. The operator must explicitly approve via the UI; the agent loop awaits an `approvalQueue.request()` Promise that only resolves on a `POST /v1/approve/:callId`.

There is **no auto-approve flag** in v1.

### 4. Auth + transport

- The Express backend requires `Authorization: Bearer <AUTH_TOKEN>` on all routes except `/v1/health`.
- The Next.js frontend never exposes the token to the browser. The browser hits `/api/*` route handlers, which run server-side and inject the token before forwarding to the backend.
- CORS is allowlisted to a single origin (`CORS_ORIGIN`, default `http://localhost:3000`).

### 5. Audit log

Every tool execution is appended to `<WORK_DIR>/../.koda/audit.log` as a JSON line:

```json
{"sessionId":"...","tool":"bash","callId":"...","ok":true,"ts":1700000000000}
```

## Known non-goals

- **No multi-tenant isolation.** Single operator, single workspace.
- **No network sandbox** for the `bash` tool. The shell can reach the network. If you don't want that, run Koda in a VM/container.
- **No model output sanitization.** Markdown is rendered with `react-markdown`, which is XSS-safe by default (no raw HTML).

## Operating recommendations

- Bind the backend to `127.0.0.1` only (default).
- Set a strong `AUTH_TOKEN` even though it's local.
- Keep `WORK_DIR` outside your home directory if you want extra confidence (e.g. `~/koda-workspace`).
- Review the audit log periodically: `tail -f .koda/audit.log`.
