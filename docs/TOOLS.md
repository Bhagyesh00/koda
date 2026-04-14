# Tools

All tool schemas live in [`packages/shared/src/tools.ts`](../packages/shared/src/tools.ts) — the single source of truth shared between backend (validation + execution) and the system prompt (model exposure).

| Tool | Approval | Purpose |
|---|---|---|
| `read_file` | auto | Read a file |
| `write_file` | required | Create/overwrite a file |
| `edit_file` | required | Exact-string replace in a file |
| `glob` | auto | Find files by pattern |
| `grep` | auto | Search file contents |
| `bash` | required | Run a shell command |
| `list_dir` | auto | List directory entries |
| `todo_write` | auto | Replace session todos |
| `plan_write` | auto | Save full plan as markdown (plan mode only) |
| `decide` | auto* | Pause and ask the user to pick from N options |
| `hypothesis` | auto* | Record a testable claim, auto-verified after next bash |
| `proof` | auto* | Register a verification command, auto-run after next mutation |
| *custom* | user-defined | Tools loaded from `<workDir>/.koda/custom-tools/*.json` |

\* These tools are intercepted by the agent loop *before* reaching the registry — they have side-effects on session state but never run as actual commands.

## Standard tool schemas

### `read_file`
```json
{ "path": "src/index.ts", "offset": 0, "limit": 200 }
```
- 1 MB max file size
- `offset` / `limit` are line numbers (0-indexed start)

### `write_file`
```json
{ "path": "hello.txt", "content": "hi\n" }
```
After execution, the loop computes a semantic diff and emits `semantic_diff` (Phase 25).

### `edit_file`
```json
{ "path": "src/foo.ts", "oldString": "foo()", "newString": "bar()", "replaceAll": false }
```
- Errors if `oldString` matches multiple times and `replaceAll=false`
- Triggers semantic diff + regret journal + mental model updates after success

### `glob`
```json
{ "pattern": "**/*.ts", "cwd": "src" }
```
- Skips `node_modules`, `.git`. Returns up to 500 paths.

### `grep`
```json
{ "pattern": "TODO|FIXME", "glob": "**/*.{ts,tsx}", "caseInsensitive": false }
```
- Returns up to 200 matches as `path:line: text`

### `bash`
```json
{ "command": "node hello.js", "timeoutMs": 30000 }
```
- Default timeout 60 s, max 120 s
- cwd locked to `WORK_DIR`
- Output truncated to 100 KB
- If a `pendingHypothesis` is set, its verification command runs automatically afterwards
- If a `pendingProof` is set, the proof command runs afterwards

### `list_dir`
```json
{ "path": "." }
```
- Hides dotfiles. Directories shown with trailing `/`.

### `todo_write`
```json
{ "todos": [{ "id": "1", "content": "Read main.ts", "status": "completed" }] }
```

### `plan_write` (plan mode only)
```json
{ "content": "# My Plan\n\n## Phase 1\n..." }
```
Saves the full plan as markdown. Only callable in plan mode. Triggers a `plan_update` SSE event.

## Meta-tools (Phase 14, 19, 24)

These three tools don't *do* anything on disk — they configure agent behavior for the next steps.

### `decide`
```json
{
  "question": "Which auth strategy should we use?",
  "options": [
    { "label": "JWT", "pros": ["stateless", "fast"], "cons": ["revocation hard"] },
    { "label": "Session cookies", "pros": ["easy revoke"], "cons": ["needs sticky sessions"] }
  ]
}
```
Pauses the loop, emits `decision_request`, awaits the user's pick via `POST /v1/decide/:callId`. The chosen option is fed back as a tool result.

### `hypothesis`
```json
{
  "claim": "Adding the index will make the slow query <50ms",
  "verification": "psql -c 'EXPLAIN ANALYZE SELECT ...'",
  "expectedOutcome": "Index Scan, total time < 50ms"
}
```
Records the prediction. After the *next* `bash` call, the verification command runs automatically and the loop emits `hypothesis_update` with `confirmed`/`refuted`.

### `proof`
```json
{
  "description": "All tests still pass",
  "command": "pnpm test"
}
```
Registers a verification command that runs *automatically* after the next `write_file`/`edit_file`/`bash`. If it exits non-zero the user is warned (`proof_result` SSE). Use this to turn code changes into contracts.

## Custom tools (Phase 17)

Drop a JSON file into `<workDir>/.koda/custom-tools/` and it becomes a callable tool. Schema:

```json
{
  "name": "deploy_staging",
  "description": "Deploy current branch to the staging environment",
  "requiresApproval": true,
  "command": "scripts/deploy.sh staging --tag {tag} --skip-tests {skip}",
  "args": [
    { "name": "tag",  "type": "string",  "description": "Image tag",       "required": true },
    { "name": "skip", "type": "boolean", "description": "Skip test phase", "required": false }
  ]
}
```

- `command` uses `{arg_name}` placeholders that get substituted at run time.
- Args are typed (`string` / `number` / `boolean`) and validated through a generated zod schema.
- Tools are loaded once at server startup and refreshed when added/edited via `POST /v1/custom-tools` (or the `CustomToolBuilder` UI).

## Calling protocol

The model emits a fenced block (one tool call per turn):

````
```tool_call
{"name": "<tool>", "args": { ... }}
```
````

The agent loop parses it, validates args via zod, runs guardrails + drift checks + blast-radius analysis, requests approval if needed, executes, and feeds the result back as a synthetic user message:

```
Tool result (<callId>):
<output>
```

Then the loop continues until the model produces a turn with no tool call.

## Tool execution lifecycle (with all phases active)

```
parse fence
  ↓
zod validate
  ↓
intercept (decide / hypothesis / proof) ──→ short-circuit
  ↓
drift check ──→ drift_warning
  ↓
guardrails ──→ block (skip) | warn (continue)
  ↓
emit tool_request
  ↓
blast radius (write/edit) ──→ blast_radius
  ↓
approval (if requiresApproval)
  ↓
capture before-content (write/edit)
  ↓
emit activity_update
  ↓
tool.run(args, ctx)
  ↓
emit tool_result + audit log
  ↓
post-processing:
  ├─ semantic diff (write/edit) ──→ semantic_diff
  ├─ regret journal (write/edit) ──→ regret_detected (if thrash)
  ├─ proof verification ──→ proof_result
  ├─ hypothesis verification (after bash) ──→ hypothesis_update
  └─ mental model update (read/write/edit) ──→ mental_model_update
```
