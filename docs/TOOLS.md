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

## Schemas

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

### `edit_file`
```json
{ "path": "src/foo.ts", "oldString": "foo()", "newString": "bar()", "replaceAll": false }
```
- Errors if `oldString` matches multiple times and `replaceAll=false`

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
- Default timeout 60s, max 120s
- cwd locked to `WORK_DIR`
- Output truncated to 100 KB

### `list_dir`
```json
{ "path": "." }
```
- Hides dotfiles. Directories shown with trailing `/`.

### `todo_write`
```json
{
  "todos": [
    { "id": "1", "content": "Read main.ts", "status": "completed" },
    { "id": "2", "content": "Add tests", "status": "in_progress" }
  ]
}
```

## Calling protocol

The model emits a fenced block (one tool call per turn):

````
```tool_call
{"name": "<tool>", "args": { ... }}
```
````

The agent loop parses it, validates args via zod, requests approval if needed, executes, and feeds the result back as a synthetic user message:

```
Tool result (<callId>):
<output>
```

Then the loop continues until the model produces a turn with no tool call.
