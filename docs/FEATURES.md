<!-- generated-by: gsd-doc-writer -->
# Koda Features

Koda is a self-hosted AI coding assistant — a local, fully-private alternative to cloud-based coding agents. It runs on your own hardware against a local [Ollama](https://ollama.ai) LLM server and exposes a streaming chat interface in the browser.

---

## Table of Contents

1. [Core Agent](#1-core-agent)
2. [Tool System](#2-tool-system)
3. [Selenium Testing Suite](#3-selenium-testing-suite)
4. [Infrastructure](#4-infrastructure)
5. [Web Search](#5-web-search)
6. [File Upload](#6-file-upload)
7. [Voice Input](#7-voice-input)
8. [Artifact Rendering](#8-artifact-rendering)
9. [CI/CD Webhook](#9-cicd-webhook)
10. [Scheduled Tasks](#10-scheduled-tasks)
11. [Multi-user Auth](#11-multi-user-auth)
12. [NL→SQL](#12-nlsql)
13. [LLM Observability (Langfuse)](#13-llm-observability-langfuse)
14. [Frontend Chat UI](#14-frontend-chat-ui)

---

## 1. Core Agent

The agent is a multi-turn agentic loop that calls tools, streams its output in real time, and maintains persistent session state.

### LLM Loop

- Streams tokens from Ollama over SSE as they are generated
- Extracts `<think>` blocks and emits them as separate `thinking` events so the UI can show or hide reasoning
- Falls back to fence-parsed tool calls (`json ...`) when the model does not emit native Ollama tool-call format
- Injects error-hint system messages on tool failure and retries up to **3 times** per tool per turn
- Hard limits: **25 tool iterations per turn**, **10-minute wall-clock timeout**

### Session Management

Sessions are the primary unit of context. Each session stores its full message history, mode, plan, snapshots, to-dos, guardrail rules, hypotheses, and a mental-model graph.

| Operation | Description |
|-----------|-------------|
| Create    | New blank session with optional `title`, `cwd`, and `model` override |
| Branch    | Fork a session at any historical snapshot |
| Snapshot  | Save a named checkpoint of the current message history |
| Replay    | Re-run a session from a snapshot |
| Compact   | Summarise old messages to reduce context size |

Sessions are persisted to **PostgreSQL** when `DATABASE_URL` is set, or as JSON files under `{WORK_DIR}/.koda/sessions/` otherwise.

### Cross-session Semantic Memory

Every completed turn is saved to a memory store. On each new turn the agent recalls the top-3 most relevant past exchanges across all sessions before generating a response.

- **With PostgreSQL + pgvector**: recalled by cosine similarity using `nomic-embed-text` embeddings (via Ollama)
- **Without PostgreSQL**: recalled by Jaccard token-overlap similarity
- Recall threshold: 0.15 similarity score
- Maximum stored entries (file mode): 500

### Sub-agent Spawning

The `agent_spawn` tool lets the agent delegate tasks to parallel sub-agents. Sub-agents run in isolated sessions with read-only tool access and return their result as a string.

### Context Window Management

- Default context window: **32,768 tokens** (configurable via `OLLAMA_NUM_CTX`)
- Sliding-window trimming: oldest messages are dropped when the total character budget (`~40,000 chars ≈ 10,000 tokens`) is exceeded
- Individual tool outputs are truncated to 6,000 characters before being stored in context; the full output is still sent to the UI

---

## 2. Tool System

Koda ships with **80+ tools** registered at startup. Tools are called by the LLM during the agentic loop and may optionally require user approval before execution.

### Files

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents |
| `write_file` | Create or overwrite a file |
| `edit_file` | Apply targeted edits to an existing file |
| `glob` | Find files matching a glob pattern |
| `grep` | Search file contents by regex |
| `list_dir` | List directory contents |

### Shell

| Tool | Description |
|------|-------------|
| `bash` | Run an arbitrary shell command |
| `run_script` | Run a named script from `package.json` or a Makefile target |

### Git

| Tool | Description |
|------|-------------|
| `git_status` | Show working tree status |
| `git_log` | Show commit history |
| `git_diff` | Show staged/unstaged diffs |
| `git_commit` | Stage and commit changes |
| `git_create_branch` | Create and/or switch branches |
| `git_tag` | Create or list tags |
| `git_stash` | Stash and pop working-tree changes |
| `git_cherry_pick` | Cherry-pick commits |

### Web

| Tool | Description |
|------|-------------|
| `web_fetch` | Fetch a URL and return its content |
| `web_search` | Search the web (Brave → SearxNG → DuckDuckGo) |
| `web_scrape` | Scrape a page with CSS selector support |
| `browser` | Full Playwright browser automation |

### Databases

**PostgreSQL (SQL)**

| Tool | Description |
|------|-------------|
| `db_query` | Run a SELECT query |
| `db_execute` | Run INSERT/UPDATE/DELETE |
| `db_transaction` | Execute a multi-statement transaction |
| `db_list_tables` | List all tables |
| `db_describe_table` | Show column definitions |
| `db_list_indexes` | List indexes |
| `db_show_schema` | Show full schema DDL |
| `db_list_foreign_keys` | List foreign key constraints |
| `db_explain` | EXPLAIN / EXPLAIN ANALYZE |
| `db_slow_queries` | Show slow queries from pg_stat_statements |
| `db_table_stats` | Table size and row-count statistics |
| `db_index_usage` | Index usage statistics |
| `db_locks` | Show current lock waits |
| `db_connections` | Show active connections |
| `db_dump` | pg_dump to file |
| `db_restore` | pg_restore from file |
| `db_migrate` | Run migration SQL files |

**NoSQL**

| Tool | Database |
|------|----------|
| `mongo_query` | MongoDB read |
| `mongo_execute` | MongoDB write |
| `mongo_list` | MongoDB collections |
| `redis_command` | Redis arbitrary command |
| `es_request` | Elasticsearch REST request |
| `cql_query` | Cassandra CQL read |
| `cql_execute` | Cassandra CQL write |
| `neo4j_query` | Neo4j Cypher |
| `dynamodb` | AWS DynamoDB operations |
| `influx_query` | InfluxDB Flux query |

### DevOps

| Tool | Description |
|------|-------------|
| `docker` | Docker CLI wrapper |
| `k8s` | kubectl wrapper |
| `aws` | AWS CLI wrapper |
| `gcp` | gcloud CLI wrapper |
| `azure` | az CLI wrapper |
| `http_request` | Generic HTTP request |
| `service_health` | Check HTTP service health endpoint |
| `port_check` | Check if a TCP port is open |

### Security

| Tool | Description |
|------|-------------|
| `secret_scan` | Scan for hardcoded secrets (regexes over file tree) |
| `dep_audit` | Run `npm audit` / `pip-audit` dependency audit |
| `ssl_check` | Verify TLS certificate validity and expiry |

### Code Quality

| Tool | Description |
|------|-------------|
| `lint` | Run the project's configured linter |
| `test_run` | Run the test suite |
| `coverage` | Generate coverage report |
| `code_metrics` | Complexity and line-count metrics |

### Data / Analytics

| Tool | Description |
|------|-------------|
| `csv_query` | Query a CSV file with SQL-like syntax |
| `json_query` | Query JSON with JMESPath |

### AI / LLM

| Tool | Description |
|------|-------------|
| `nl_to_sql` | Natural-language → SQL via SQLCoder model |
| `image_generate` | Text-to-image via AUTOMATIC1111 Stable Diffusion |
| `image_read` | Describe the contents of an image |

### Agent & Workflow

| Tool | Description |
|------|-------------|
| `agent_spawn` | Spawn a parallel sub-agent |
| `todo_write` | Update the session's to-do list |
| `plan_write` | Write or update the session plan (plan mode only) |
| `decide` | Record a decision with rationale |
| `hypothesis` | State a hypothesis to be verified |
| `proof` | Record a proof for an earlier hypothesis |
| `changelog` | Append an entry to CHANGELOG.md |
| `notify` | Send a desktop notification |
| `env_get` | Read an environment variable |
| `json_patch` | Apply a JSON Patch to a file |

### Permission Modes

Tools are gated by the session's current mode:

| Mode | Allowed Tools |
|------|--------------|
| Plan | `read_file`, `glob`, `grep`, `list_dir`, `plan_write` |
| Build (default) | All tools except `plan_write` |

Tools marked `requiresApproval: true` pause execution and request user confirmation before running. Approval can be granted, denied (with optional reason), or the arguments can be edited inline before approving.

---

## 3. Selenium Testing Suite

Koda includes a built-in browser testing framework powered by Selenium WebDriver. Three tools cover single tests, multi-scenario suites, and video-to-test recording.

### `selenium_test` — Single Prompt-driven Test

Run a browser test described in plain English. The agent interprets the prompt and executes the corresponding Selenium steps.

```
url: https://example.com
prompt: "Navigate to the login page, enter user@example.com and password123, click Sign In, assert the dashboard heading is visible"
browser: chrome
headless: true
recordVideo: true
```

Output includes:
- Pass/fail status per step with a self-healed indicator
- HTML report saved to `{WORK_DIR}/.koda/selenium-reports/run-{ts}/`
- Screenshot directory
- MP4 video of the run (or an HTML frame-player fallback when ffmpeg is unavailable)

### `selenium_suite` — Multi-scenario Data-driven Suite

Run multiple scenarios in a single call with support for parallel execution, data fixtures, and JUnit XML / JSON / HTML reports.

### `selenium_from_video` — Record Screen → Auto-generate Test

Record a screen capture of a manual test flow; Koda will analyse the video frames, infer the intended steps, generate the Selenium test code, and execute it.

### Supported Actions (30+)

`click`, `type`, `scroll`, `assert_text`, `assert_visible`, `assert_url`, `navigate`, `wait_for`, `hover`, `select`, `check`, `uncheck`, `upload_file`, `switch_frame`, `switch_to_default`, `shadow_dom_click`, `shadow_dom_type`, `accept_alert`, `dismiss_alert`, `get_alert_text`, `execute_script`, `drag_and_drop`, `right_click`, `double_click`, `key_press`, `clear`, `get_text`, `get_attribute`, `take_screenshot`, `wait_for_network_idle`

### Browsers

Chrome, Firefox, and Edge are supported. Browser drivers are bundled — no manual driver installation required.

---

## 4. Infrastructure

Koda ships a `docker-compose.yml` that starts all required services with a single command.

### Services

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `postgres` | `pgvector/pgvector:pg16` | 5432 | Session storage + pgvector semantic memory |
| `redis` | `redis:7-alpine` | 6379 | Tool output caching |
| `searxng` | `searxng/searxng:latest` | 8888 | Self-hosted web search (no API key needed) |
| `langfuse-db` | `postgres:16-alpine` | — | Internal DB for Langfuse |
| `langfuse` | `langfuse/langfuse:latest` | 3001 | LLM observability UI |
| `backend` | (local build) | 4001 | Koda Express API |
| `frontend` | (local build) | 4000 | Next.js chat UI |

### Database Migrations

SQL migration files under `apps/backend/src/db/migrations/` are run automatically at backend startup. No manual migration steps are required.

### File-based Fallback

Every service that uses PostgreSQL falls back to JSON files on disk when `DATABASE_URL` is not set:
- Sessions → `{WORK_DIR}/.koda/sessions/`
- Memory entries → `{WORK_DIR}/.koda/memory.json`
- Schedules → in-memory only (lost on restart)

---

## 5. Web Search

The `web_search` tool uses a priority fallback chain so that search always works regardless of which services are configured.

```
Brave Search API  →  SearxNG (self-hosted)  →  DuckDuckGo HTML scraping
```

| Provider | Requires | Quality | Notes |
|----------|----------|---------|-------|
| Brave Search API | `BRAVE_SEARCH_API_KEY` | High | 2,000 free queries/month |
| SearxNG | `SEARXNG_URL` | High | Auto-configured in Docker Compose at `http://searxng:8080` |
| DuckDuckGo HTML | Nothing | Medium | No key needed; may be rate-limited under heavy use |

The Docker Compose stack runs SearxNG on port 8888 (`http://localhost:8888` from the host). For local development without Docker, start SearxNG with:

```bash
docker run -p 8888:8080 searxng/searxng
```

Then set `SEARXNG_URL=http://localhost:8888` in your `.env`.

---

## 6. File Upload

### API Endpoint

`POST /v1/upload` accepts multipart form data with a `files` field (up to 20 files per request, 50 MB per file).

**Response:**
```json
{
  "files": [
    {
      "originalName": "diagram.png",
      "savedName": "1713456789012_diagram.png",
      "path": "/app/workspace/.koda/uploads/1713456789012_diagram.png",
      "size": 204800,
      "mimeType": "image/png"
    }
  ]
}
```

Uploaded files are served back at `GET /v1/uploads/:filename`.

### Allowed File Types

`txt`, `md`, `pdf`, `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `json`, `csv`, `ts`, `js`, `py`, `rs`, `go`, `java`, `c`, `cpp`, `h`, `yml`, `yaml`, `toml`, `xml`, `html`, `css`, `mp4`, `webm`, `mov`, `mp3`, `wav`

### Frontend Integration

A paperclip button in the chat composer opens the file picker. Selected files are uploaded and attached to the next message.

---

## 7. Voice Input

A microphone button in the chat composer enables hands-free input using the browser's **Web Speech API**.

- Transcribed text is inserted directly into the message input field
- No backend component required — transcription runs entirely in the browser
- Works in Chrome and Edge; Firefox support depends on the browser build

---

## 8. Artifact Rendering

Any assistant message containing a fenced ` ```html ` or ` ```svg ` code block is automatically rendered as a sandboxed `<iframe>` inline in the chat.

- **Source / Preview toggle** — switch between the raw code and the live render
- **Fullscreen mode** — expand the artifact to fill the viewport
- **Copy button** — copy the source code to the clipboard
- The iframe uses `sandbox` attributes to prevent script execution from escaping the chat frame

---

## 9. CI/CD Webhook

Trigger Koda agent runs from CI pipelines or external automation without a browser.

### Endpoint

```
POST /v1/webhook/run
Authorization: Bearer <AUTH_TOKEN>
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | Yes | The task prompt to send to the agent |
| `sessionId` | string | No | Reuse an existing session; creates a new one if omitted |
| `workDir` | string | No | Working directory for the agent (overrides `WORK_DIR`) |
| `timeoutMs` | number | No | Abort after this many ms (default: 120,000) |

### Response

```json
{
  "sessionId": "abc123",
  "status": "completed",
  "response": "The agent's final text output..."
}
```

Webhook runs execute with `autoApproveAll: true` — all tool calls are approved automatically without user interaction.

---

## 10. Scheduled Tasks

Run agent tasks on a cron schedule without manual intervention.

### API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/schedules` | Create a new schedule |
| `GET` | `/v1/schedules` | List all schedules |
| `PATCH` | `/v1/schedules/:id` | Enable or disable a schedule |
| `DELETE` | `/v1/schedules/:id` | Delete a schedule |
| `POST` | `/v1/schedules/:id/run` | Trigger a schedule manually |

### Create Request Body

```json
{
  "name": "Daily test run",
  "cronExpr": "0 9 * * 1-5",
  "message": "Run the test suite and report any failures",
  "workDir": "/path/to/project"
}
```

- `cronExpr` is validated with `node-cron` before creation
- `sessionId` can be specified to reuse an existing session; omit to create a fresh one each run
- Schedules are persisted to PostgreSQL when `DATABASE_URL` is set; otherwise they are held in memory and lost on restart

---

## 11. Multi-user Auth

Koda supports multiple user accounts with role-based access when a PostgreSQL database is configured.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/auth/register` | Register a new user account |
| `POST` | `/v1/auth/login` | Log in and receive a JWT |
| `GET` | `/v1/auth/me` | Verify a JWT and return user info |

### Registration Rules

- The **first** registered user automatically becomes `admin`
- Subsequent registrations require the `adminToken` field to equal `AUTH_TOKEN`
- Password minimum length: 8 characters
- Passwords are hashed with bcrypt (cost factor 12)

### JWT

- Tokens are signed with `JWT_SECRET` and expire after **7 days**
- The `GET /v1/auth/me` endpoint also accepts the legacy `AUTH_TOKEN` static token for backward compatibility

### Requires

Multi-user auth requires `DATABASE_URL` to be configured. Without a database, all authentication routes return `503 Service Unavailable`.

---

## 12. NL→SQL

The `nl_to_sql` tool converts a natural-language question into a SQL query using the **SQLCoder** model running locally in Ollama.

### Usage (via agent)

When the agent needs to query a database from a natural-language description, it calls:

```
question: "How many users signed up last week?"
schema:   "CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT, created_at TIMESTAMPTZ);"
dialect:  "postgresql"   -- or "mysql" / "sqlite"
```

The tool returns a formatted SQL query:

```sql
SELECT COUNT(*)
FROM users
WHERE created_at >= NOW() - INTERVAL '7 days';
```

### Setup

```bash
# Pull the SQLCoder model (one-time setup)
make pull-sqlcoder
# or
ollama pull sqlcoder
```

If the model is not found, the tool returns a descriptive error with the pull command.

---

## 13. LLM Observability (Langfuse)

Every agent turn is traced in [Langfuse](https://langfuse.com) when the Langfuse keys are configured.

### What is Traced

- **Trace**: one per agent turn, keyed by `sessionId`, with the user message as input and the final assistant message as output
- **Generation span**: the Ollama model call — captures model name, prompt, response, and latency
- **Tool spans**: one per tool call — captures tool name, input arguments, output (truncated to 1,000 chars), and error level on failure

### Accessing the UI

The Docker Compose stack runs Langfuse at **http://localhost:3001**. Create an account on first visit, then copy the API keys from Settings → API Keys into your `.env`.

### Optional

Langfuse is disabled when `LANGFUSE_SECRET_KEY` or `LANGFUSE_PUBLIC_KEY` are not set. The agent works normally without it.

---

## 14. Frontend Chat UI

The Next.js frontend runs on **port 4000** and provides a full-featured chat interface.

### Message Composer

- **@ mentions** — type `@` to attach files, folders, or trigger a web search that injects results into the message
- **Paperclip button** — upload files from disk (see [File Upload](#6-file-upload))
- **Mic button** — voice input via Web Speech API (see [Voice Input](#7-voice-input))

### Slash Commands

| Command | Effect |
|---------|--------|
| `/clear` | Clear the current session's message history |
| `/compact` | Summarise old messages to free up context window space |
| `/model <name>` | Switch the Ollama model for the current session |

### Permission Modes

| Mode | Description |
|------|-------------|
| Ask | Pause and ask before every tool call |
| Accept edits | Auto-approve file edits, ask for shell/destructive tools |
| Plan mode | Restrict to read-only tools + `plan_write`; used to create a plan before execution |
| Bypass | Auto-approve all tools (equivalent to webhook `autoApproveAll`) |

### Thinking Blocks

Toggle the display of the model's `<think>` reasoning blocks. When enabled, thinking content appears inline before the assistant's visible response.

### Skill System

Skills are CLAUDE.md-style instruction files that can be loaded into a session to change the agent's behaviour (e.g., a "code review" skill with specific review criteria). Skills are registered at the backend and selectable in the session settings.

### Side Panels

| Panel | Purpose |
|-------|---------|
| Plan | View and edit the session plan |
| Todo | Track outstanding tasks |
| Guardrails | Define rules that block specific tool calls |
| Context Lens | Inspect what context the agent currently holds |
| Hypothesis Log | View hypotheses the agent has stated and their verification status |
| Snapshot Timeline | Browse session snapshots and branch from any point |
| Mental Model Canvas | Visual graph of entities and relationships the agent has built up |
| Regret Panel | Post-hoc analysis of decisions the agent regrets |
| Token Dashboard | Live token usage and budget tracking |
| Sub-agent Panel | Monitor spawned sub-agent tasks |
