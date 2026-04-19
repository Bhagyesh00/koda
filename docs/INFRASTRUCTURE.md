# Infrastructure & AI Upgrades

This document covers the infrastructure sprint that added Docker Compose, PostgreSQL session storage, pgvector semantic memory, Langfuse LLM monitoring, and the SQLCoder NL→SQL tool.

---

## Overview

| Feature | Technology | Status |
|---------|-----------|--------|
| Containerization | Docker + Docker Compose | ✅ Added |
| Session storage | PostgreSQL (replaces JSON files) | ✅ Added |
| Semantic memory | pgvector + nomic-embed-text | ✅ Added |
| LLM observability | Langfuse (self-hosted) | ✅ Added |
| NL→SQL | SQLCoder via Ollama | ✅ Added |

---

## Quick Start

### 1. Configure environment

```bash
make env          # copies .env.example → .env
```

Open `.env` and set at minimum:

```env
AUTH_TOKEN=your-secret-here
DATABASE_URL=postgresql://koda:koda_secret@localhost:5432/koda
```

### 2. Start all services

```bash
make docker-build
```

This pulls images and starts 6 containers:

| Container | Port | Purpose |
|-----------|------|---------|
| `postgres` | 5432 | App database (sessions + pgvector memory) |
| `redis` | 6379 | Caching / rate limiting |
| `langfuse-db` | — | Internal Langfuse database |
| `langfuse` | 3001 | LLM observability UI |
| `backend` | 4001 | Koda Express API |
| `frontend` | 4000 | Koda Next.js UI |

### 3. Pull Ollama models (once)

```bash
make pull-embed-model    # nomic-embed-text — semantic memory embeddings
make pull-sqlcoder       # sqlcoder — NL→SQL generation
```

### 4. Enable Langfuse (optional)

1. Open `http://localhost:3001` and create an account
2. Go to **Settings → API Keys** → create a new key pair
3. Add to `.env`:

```env
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_HOST=http://localhost:3001
```

4. Restart: `make docker-down && make docker-up`

---

## Docker Commands

```bash
make docker-build    # Build images and start all services
make docker-up       # Start services (images already built)
make docker-down     # Stop all services
make docker-logs     # Tail logs from all containers
```

---

## PostgreSQL Session Storage

### How it works

Sessions are stored as JSONB rows in PostgreSQL instead of individual `.json` files. An **in-memory Map** is maintained as a write-through cache — all reads are O(1) from memory, all writes go to both memory and PostgreSQL asynchronously.

**Fallback:** If `DATABASE_URL` is not set, the system falls back to JSON file storage with zero behavior change.

### Schema

```sql
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Migrations

Migrations run automatically on backend startup from `apps/backend/src/db/migrations/`. Each file runs once and is tracked in the `schema_migrations` table.

```
apps/backend/src/db/
├── client.ts               # pg Pool + query() helper
├── migrate.ts              # auto-runs SQL files on startup
└── migrations/
    ├── 001_sessions.sql    # sessions table
    └── 002_memory.sql      # pgvector memory_entries table
```

### Verify

```bash
psql $DATABASE_URL -c "SELECT id, data->>'title', updated_at FROM sessions ORDER BY updated_at DESC LIMIT 5"
```

---

## pgvector Semantic Memory

### How it works

Cross-session memory recall is upgraded from **Jaccard keyword similarity** to **cosine similarity over vector embeddings**. When a new turn starts, the user message is embedded and the closest past exchanges from other sessions are retrieved and injected as context.

**Embedding model:** `nomic-embed-text` (768 dimensions) via Ollama  
**Index type:** HNSW (`vector_cosine_ops`) for fast approximate nearest-neighbor search  
**Fallback:** If `DATABASE_URL` is not set, falls back to Jaccard similarity (original behavior)

### Schema

```sql
CREATE TABLE memory_entries (
  id             TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL,
  user_text      TEXT NOT NULL,
  assistant_text TEXT NOT NULL,
  embedding      vector(768),
  ts             BIGINT NOT NULL
);

CREATE INDEX memory_embedding_idx ON memory_entries
  USING hnsw (embedding vector_cosine_ops);
```

### Key files

| File | Purpose |
|------|---------|
| `apps/backend/src/memory/embeddings.ts` | Calls `OLLAMA_BASE_URL/api/embeddings` |
| `apps/backend/src/memory/store.ts` | `remember()` + `recall()` with pg/Jaccard switch |
| `apps/backend/src/db/migrations/002_memory.sql` | Table + HNSW index |

### Verify

```bash
psql $DATABASE_URL -c "SELECT count(*) FROM memory_entries"
psql $DATABASE_URL -c "SELECT session_id, left(user_text, 60) FROM memory_entries LIMIT 5"
```

---

## Langfuse LLM Monitoring

### What is traced

Every agent turn produces one **trace** in Langfuse containing:

| Span type | What it captures |
|-----------|-----------------|
| `generation` (ollama) | Model name, input messages, full output, latency |
| `span` (tool name) | Tool args (input), tool output (truncated to 1000 chars), error level on failure |

Traces are grouped by `sessionId` so you can see the full conversation history for any session.

### Configuration

```env
LANGFUSE_SECRET_KEY=sk-lf-...     # from Langfuse Settings → API Keys
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_HOST=http://localhost:3001
```

When keys are **not** set, Langfuse is silently disabled — no errors, no overhead.

### UI

Open `http://localhost:3001` after `make docker-up`.

### Key files

| File | Purpose |
|------|---------|
| `apps/backend/src/telemetry/langfuse.ts` | Client init, `createTrace()` helper |
| `apps/backend/src/agent/loop.ts` | Instrumentation points (import + 4 call sites) |

---

## NL→SQL Tool (`nl_to_sql`)

Converts natural language questions to SQL using the **SQLCoder** model running locally via Ollama.

### Usage

In any Koda chat session, ask the agent to use the tool:

> *"Convert to SQL: how many users signed up in the last 30 days? Schema: `users(id INT, email TEXT, created_at TIMESTAMPTZ)`"*

Or invoke directly:

```json
{
  "tool": "nl_to_sql",
  "question": "Which products have never been ordered?",
  "schema": "CREATE TABLE products (id INT, name TEXT);\nCREATE TABLE orders (id INT, product_id INT);",
  "dialect": "postgresql"
}
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `question` | string | ✅ | Natural language question |
| `schema` | string | ✅ | DDL — `CREATE TABLE` statements |
| `dialect` | enum | — | `postgresql` (default), `mysql`, `sqlite` |

### Setup

```bash
make pull-sqlcoder    # downloads sqlcoder model via ollama
```

If the model is not installed, the tool returns a clear error with the pull command.

### Key files

| File | Purpose |
|------|---------|
| `apps/backend/src/tools/nlToSql.ts` | Tool implementation |
| `packages/shared/src/tools.ts` | `NlToSqlArgs` schema + TOOL_DESCRIPTORS entry |

---

## Local Dev (without Docker)

All features are backward compatible. Without `DATABASE_URL`:

- Sessions → JSON files in `<WORK_DIR>/.koda/sessions/`
- Memory → Jaccard similarity + `memory.json` file
- Langfuse → disabled (no keys)
- NL→SQL → works as long as `sqlcoder` is pulled in Ollama

```bash
make dev    # starts backend + frontend normally
```

---

## Selenium Testing

Two prompt-driven browser automation tools built on `selenium-webdriver`. Both accept a natural language scenario, which the LLM planner (backed by Ollama) converts into structured steps executed against Chrome, Firefox, or Edge.

### Tools

| Tool | Use for |
|------|---------|
| `selenium_test` | Single scenario — login flows, form submissions, smoke tests |
| `selenium_suite` | Multiple scenarios — regression runs, data-driven tests, cross-browser batches |

Both produce HTML reports with per-step screenshots. `selenium_suite` additionally emits JSON and JUnit XML for CI integration.

### Supported actions (30+)

**Interaction:** `click`, `type`, `press_key`, `select_option`, `check`, `uncheck`, `upload_file`, `hover`, `scroll`

**Navigation:** `navigate`, `go_back`, `go_forward`, `refresh`

**Context switching:** `switch_frame`, `exit_frame`, `switch_tab`, `new_tab`, `close_tab`, `accept_alert`, `dismiss_alert`, `type_in_alert`

**Utility:** `wait_for`, `screenshot`, `execute_js`, `set_cookie`, `delete_cookie`

**Assertions:** `assert_text`, `assert_title`, `assert_url`, `assert_count`, `assert_attribute`, `assert_visible`, `assert_hidden`, `assert_regex`, `assert_css`, `assert_alert`

**Locators:** `by: "css"` (default) · `"xpath"` · `"text"` (match visible text) · `"shadow"` (`host >> inner >> deeper` for shadow DOM traversal)

### Browser support

Bundled drivers via `chromedriver`, `geckodriver`, `edgedriver` — no global installs needed. User must have Chrome / Firefox / Edge installed on the host.

```json
{ "browser": "chrome" | "firefox" | "edge" }
```

### Resilience

- **DOM pre-scan** before planning — planner sees real selectors, not guesses
- **Self-heal** — on step failure, re-scans DOM and asks LLM for a corrected step; retries once before giving up
- **Locator fallbacks** — CSS → XPath text match if selector looks like plain words
- **Auto scroll-into-view** before click/type

### Single-test example

```
Use selenium_test on https://www.saucedemo.com with browser=firefox and headless=false —
Log in as "standard_user" / "secret_sauce", add the backpack to cart, check out as
"Koda Test" with postal code 12345, and assert "Thank you for your order" appears.
```

### Suite with data-driven runs + parallel

```json
{
  "tool": "selenium_suite",
  "browser": "chrome",
  "concurrency": 2,
  "reportFormats": ["html", "json", "junit"],
  "setup": "Accept cookie banner if visible",
  "scenarios": [
    {
      "name": "login",
      "url": "https://www.saucedemo.com",
      "prompt": "Log in as {{user}} / {{pass}}, then assert URL contains inventory"
    }
  ],
  "dataSet": [
    { "user": "standard_user", "pass": "secret_sauce" },
    { "user": "problem_user", "pass": "secret_sauce" },
    { "user": "locked_out_user", "pass": "secret_sauce" }
  ]
}
```

Produces 3 scenario runs (2 parallel at a time), an `index.html` summary, a `results.json` for programmatic consumption, and `junit.xml` that Jenkins/GitLab CI/CircleCI can parse natively.

### Video recording

Capture a video replay of the test. Pass `recordVideo: true` for defaults (5 fps, MP4), or customize:

```json
{ "recordVideo": { "enabled": true, "fps": 10, "format": "mp4" } }
```

**Format modes:**

| Mode | Behavior |
|------|----------|
| `mp4` (default) | Encodes frames to MP4 via `ffmpeg` if installed on PATH. Falls back to frames + HTML player if not. |
| `frames` | Always saves raw PNG frames + an HTML player (`player.html`) with play/pause/scrubber. No dependencies. |

The resulting video is embedded as a `<video>` tag in the scenario HTML report (MP4) or linked as a "Watch recording" button (frames).

**Installing ffmpeg for MP4 output:**
- Windows: `winget install ffmpeg` or `choco install ffmpeg`
- macOS: `brew install ffmpeg`
- Linux: `apt install ffmpeg` / `dnf install ffmpeg`

Without ffmpeg, the frames + HTML player works identically — just open `_frames/player.html` in a browser instead of watching an MP4.

**Tradeoffs:**
- Higher `fps` = smoother video but slower test (each frame is a driver screenshot)
- 5 fps is the sweet spot — test barely slowed, enough detail to review
- Frames are deleted automatically after successful MP4 encoding

### Video-to-test (`selenium_from_video`)

Reverse direction: record yourself doing something in a browser, feed the video to Koda, and have it automatically generate + execute a Selenium test. Uses a multimodal Ollama model (vision-capable) to interpret the frames.

**How it works:**
1. Extracts `frameSamples` evenly-spaced keyframes from the video via bundled ffmpeg
2. OCRs the top of the first frame (address bar area) via `tesseract.js` to detect the starting URL — or uses a user-provided URL
3. Sends all keyframes to a vision LLM with a QA-generator prompt, which outputs a natural language test scenario
4. Feeds that scenario into the regular `selenium_test` pipeline (plan → execute → report)
5. Returns an HTML report including screenshots, optional replay video, and the generated scenario text

**Prerequisites:**

```bash
# Pull a vision-capable Ollama model (example)
ollama pull gemma3:4b          # newer Gemma supports images
# or: ollama pull llava:13b
# or: ollama pull llama3.2-vision
```

ffmpeg is **bundled** via `@ffmpeg-installer/ffmpeg` — no system install required.

**Dry run (preview the generated scenario without executing):**

```json
{
  "tool": "selenium_from_video",
  "videoPath": "C:\\Users\\ADMIN\\Desktop\\login-recording.mp4",
  "visionModel": "gemma3:4b",
  "dryRun": true
}
```

Returns the detected URL, vision model used, and the generated scenario text for you to review.

**Auto-run with replay video:**

```json
{
  "tool": "selenium_from_video",
  "videoPath": "C:\\Users\\ADMIN\\Desktop\\login-recording.mp4",
  "visionModel": "gemma3:4b",
  "headless": false,
  "recordVideo": true
}
```

Extracts frames → generates scenario → runs it in Chrome → records replay. You end up with both the input video and a replay to compare side-by-side.

**With pre-extracted frames (no ffmpeg needed):**

```json
{
  "tool": "selenium_from_video",
  "framesDir": "C:\\Users\\ADMIN\\Desktop\\login-frames",
  "url": "https://www.saucedemo.com"
}
```

**Args:**

| Field | Default | Purpose |
|-------|---------|---------|
| `videoPath` | — | Path to mp4/webm/mov. Required unless `framesDir` is set. |
| `framesDir` | — | Pre-extracted PNG/JPG frames dir. Alternative to `videoPath`. |
| `url` | — | Starting URL. If omitted, OCR the first frame. |
| `visionModel` | `OLLAMA_MODEL` | Ollama model tag (must accept images). |
| `frameSamples` | `8` | How many keyframes to extract + analyze (2–30). |
| `dryRun` | `false` | Return scenario without executing. |
| `recordVideo` | — | Also record the replay. |
| `browser`, `headless`, `slowMoMs`, `timeoutMs`, `reportDir` | — | Same as `selenium_test`. |

**Tradeoffs:**
- Vision model quality matters a lot — `gemma3:4b` or `llava:13b` work well, smaller models may miss details
- 6–10 keyframes is usually enough; more = slower LLM call, not necessarily better
- OCR on the address bar can miss when Chrome is in kiosk/fullscreen mode or the URL bar is off-screen — pass `url` explicitly in those cases
- The generated scenario is saved to `<reportDir>/generated-scenario.txt` so you can edit and re-run it later with `selenium_test`

### HTTP Basic Auth

```json
{ "basicAuth": { "username": "user", "password": "pass" } }
```

- Chrome/Edge: injected via CDP `Network.setExtraHTTPHeaders`
- Firefox: rewritten into URL userinfo (`https://user:pass@host/...`)

### Cookies

```json
{ "cookies": [{ "name": "session", "value": "abc123", "domain": "example.com" }] }
```

Applied after the first navigation so domain is bound; the tool re-navigates to activate them.

### Key files

| File | Purpose |
|------|---------|
| `apps/backend/src/tools/seleniumTest.ts` | Thin wrapper — single scenario |
| `apps/backend/src/tools/seleniumSuite.ts` | Thin wrapper — multi-scenario + reports |
| `apps/backend/src/tools/selenium/runner.ts` | Core scan/plan/heal/step executor (shared) |
| `apps/backend/src/tools/selenium/driverFactory.ts` | Chrome/Firefox/Edge builder + basic auth |
| `apps/backend/src/tools/selenium/report.ts` | HTML/JSON/JUnit renderers |
| `apps/backend/src/tools/selenium/keyMap.ts` | Key name → `Key.*` aliases |
| `packages/shared/src/tools.ts` | `SeleniumTestArgs` + `SeleniumSuiteArgs` schemas |

---

## Environment Variables Reference

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `DATABASE_URL` | No | — | Enables PostgreSQL for sessions + pgvector memory |
| `LANGFUSE_SECRET_KEY` | No | — | Enables Langfuse tracing |
| `LANGFUSE_PUBLIC_KEY` | No | — | Enables Langfuse tracing |
| `LANGFUSE_HOST` | No | `http://localhost:3001` | Langfuse base URL |
| `REDIS_URL` | No | — | Redis connection (for future use) |
