<!-- generated-by: gsd-doc-writer -->
# Koda Configuration

All configuration is done through environment variables. Copy `.env.example` to `.env` in the project root and edit the values before starting the server.

```bash
cp .env.example .env
```

---

## Table of Contents

1. [Required Settings](#1-required-settings)
2. [Optional — Databases](#2-optional--databases)
3. [Optional — Web Search](#3-optional--web-search)
4. [Optional — LLM Observability (Langfuse)](#4-optional--llm-observability-langfuse)
5. [Optional — Ollama Auth](#5-optional--ollama-auth)
6. [Optional — Image Generation (Stable Diffusion)](#6-optional--image-generation-stable-diffusion)
7. [Optional — Multi-user Auth](#7-optional--multi-user-auth)
8. [Optional — Misc](#8-optional--misc)
9. [Frontend Environment Variables](#9-frontend-environment-variables)
10. [External Services Setup](#10-external-services-setup)

---

## 1. Required Settings

These three variables are the minimum needed to start Koda.

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_TOKEN` | `dev-secret-change-me` | Shared secret that protects all API endpoints. **Change this in production.** |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Base URL of the Ollama server to use for inference. |
| `OLLAMA_MODEL` | `koda` | Name of the Ollama model to run. Must already be pulled (`ollama pull <name>`). |

**Minimum `.env`:**

```dotenv
AUTH_TOKEN=your-secret-here
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5-coder:7b
```

> If `AUTH_TOKEN` is left at the default `dev-secret-change-me` value, the server will start but print a warning. Always change it before exposing Koda to a network.

---

## 2. Optional — Databases

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | _(unset)_ | PostgreSQL connection string. Enables persistent session storage and pgvector semantic memory. Falls back to JSON files under `{WORK_DIR}/.koda/` when unset. |
| `REDIS_URL` | _(unset)_ | Redis connection URL. Enables tool output caching. |

### PostgreSQL

```dotenv
DATABASE_URL=postgresql://user:password@localhost:5432/koda
```

When set:
- Sessions are stored in the `sessions` table instead of JSON files
- Memory entries are stored in the `memory_entries` table with pgvector embeddings for semantic recall
- Multi-user auth (JWT) is available
- Scheduled tasks survive restarts

Migrations run automatically at startup — no manual schema setup is required.

### Redis

```dotenv
REDIS_URL=redis://localhost:6379
```

When set, expensive tool outputs (e.g., web search results, database query results) are cached in Redis to avoid redundant calls within the same session.

> Both `DATABASE_URL` and `REDIS_URL` are set automatically inside the Docker Compose stack. You only need to set them manually for local development outside Docker.

---

## 3. Optional — Web Search

The `web_search` tool uses a priority fallback chain: **Brave → SearxNG → DuckDuckGo**.

| Variable | Default | Description |
|----------|---------|-------------|
| `BRAVE_SEARCH_API_KEY` | _(unset)_ | Brave Search API key. When set, Brave is used first (highest quality). |
| `SEARXNG_URL` | _(unset)_ | SearxNG instance base URL. Auto-set to `http://searxng:8080` inside Docker Compose. |

If neither variable is set, the tool falls back to DuckDuckGo HTML scraping — no key required, but results may be rate-limited under heavy use.

```dotenv
# Option A: Brave Search (recommended for production)
BRAVE_SEARCH_API_KEY=BSA...

# Option B: Self-hosted SearxNG
SEARXNG_URL=http://localhost:8888
```

---

## 4. Optional — LLM Observability (Langfuse)

| Variable | Default | Description |
|----------|---------|-------------|
| `LANGFUSE_SECRET_KEY` | _(unset)_ | Langfuse secret key from Settings → API Keys. |
| `LANGFUSE_PUBLIC_KEY` | _(unset)_ | Langfuse public key from Settings → API Keys. |
| `LANGFUSE_HOST` | `http://localhost:3001` | Langfuse base URL. Defaults to the self-hosted instance started by Docker Compose. |

All three variables must be set together to enable tracing. Langfuse is silently disabled when either key is absent.

```dotenv
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_HOST=http://localhost:3001
```

---

## 5. Optional — Ollama Auth

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_USERNAME` | _(unset)_ | HTTP Basic Auth username for a password-protected remote Ollama server. |
| `OLLAMA_PASSWORD` | _(unset)_ | HTTP Basic Auth password for a password-protected remote Ollama server. |

Both must be set together to enable Basic Auth. Leave unset for a local Ollama instance without auth.

```dotenv
OLLAMA_USERNAME=myuser
OLLAMA_PASSWORD=mypassword
```

---

## 6. Optional — Image Generation (Stable Diffusion)

Used by the `image_generate` tool to call the AUTOMATIC1111 Stable Diffusion WebUI API.

| Variable | Default | Description |
|----------|---------|-------------|
| `SD_BASE_URL` | `http://localhost:7860` | AUTOMATIC1111 WebUI base URL. Must be started with `--api` flag. |
| `SD_MODEL` | _(unset)_ | Checkpoint name as shown in the A1111 UI (e.g., `realisticVisionV51.safetensors`). Uses the currently loaded model if unset. |
| `SD_WIDTH` | `512` | Default image width in pixels. |
| `SD_HEIGHT` | `512` | Default image height in pixels. |
| `SD_STEPS` | `20` | Number of diffusion steps. Higher values produce better quality but take longer. |
| `SD_CFG_SCALE` | `7` | Classifier-free guidance scale. Higher values follow the prompt more strictly. |
| `SD_SAMPLER` | `DPM++ 2M Karras` | Sampler algorithm. |
| `SD_NEGATIVE_PROMPT` | `blurry, bad quality, watermark, text, deformed` | Default negative prompt appended to every generation request. |

```dotenv
SD_BASE_URL=http://localhost:7860
SD_MODEL=realisticVisionV51.safetensors
SD_WIDTH=768
SD_HEIGHT=768
SD_STEPS=25
SD_CFG_SCALE=7
SD_SAMPLER=DPM++ 2M Karras
```

---

## 7. Optional — Multi-user Auth

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | `koda_jwt_secret_change_me_in_production` | Secret used to sign and verify JWTs. **Change this in production.** |

> Multi-user auth is only available when `DATABASE_URL` is configured. Without a database, registration and login endpoints return `503`.

```dotenv
JWT_SECRET=a-long-random-string-here
```

---

## 8. Optional — Misc

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKEND_PORT` | `4001` | TCP port the Express backend listens on. |
| `CORS_ORIGIN` | `http://localhost:4000` | Allowed CORS origin for browser requests. Set to your frontend's public URL in production. |
| `LOG_LEVEL` | `info` | Pino log level: `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace`. |
| `WORK_DIR` | `./workspace` | Directory used as the default working directory for agent tool calls. Created automatically if it does not exist. |
| `OLLAMA_NUM_CTX` | `32768` | Context window size (tokens) passed to Ollama. Increase for larger codebases; decrease if you hit out-of-memory errors. |

---

## 9. Frontend Environment Variables

These variables are read by the Next.js server process (not the browser). They tell the frontend how to reach the backend.

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKEND_URL` | `http://localhost:4001` | Backend base URL as seen by the Next.js server. Inside Docker Compose this is set to `http://backend:4001`. |
| `BACKEND_AUTH_TOKEN` | `dev-secret-change-me` | Token the frontend sends to the backend. Must match `AUTH_TOKEN`. |

> In the Docker Compose stack, `BACKEND_URL` and `BACKEND_AUTH_TOKEN` are already set correctly. Only change them if you are running the frontend outside Docker while the backend is on a different host.

---

## 10. External Services Setup

### Ollama

1. Install Ollama from https://ollama.ai
2. Pull a coding-capable model:
   ```bash
   # Default model used by Koda
   ollama pull koda

   # Alternatives
   ollama pull qwen2.5-coder:7b
   ollama pull deepseek-coder-v2:16b
   ```
3. Ollama listens on `http://localhost:11434` by default
4. Set `OLLAMA_BASE_URL` in `.env` if you are running Ollama on a different host or port

### Brave Search API

1. Sign up at https://brave.com/search/api/
2. The free tier provides **2,000 queries per month**
3. Copy the API key and set it in `.env`:
   ```dotenv
   BRAVE_SEARCH_API_KEY=BSAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

### SearxNG (Self-hosted)

**Quick start for local development (outside Docker):**

```bash
docker run -d \
  --name searxng \
  -p 8888:8080 \
  -e SEARXNG_SECRET=change-me \
  searxng/searxng
```

Then set:
```dotenv
SEARXNG_URL=http://localhost:8888
```

The Docker Compose stack includes SearxNG pre-configured — no manual setup needed when using `docker compose up`.

### Stable Diffusion (AUTOMATIC1111)

1. Install AUTOMATIC1111 WebUI from https://github.com/AUTOMATIC1111/stable-diffusion-webui
2. Launch with the `--api` flag:
   ```bash
   # Linux / macOS
   python launch.py --api --xformers --medvram

   # Windows
   webui-user.bat  # add --api to COMMANDLINE_ARGS in webui-user.bat
   ```
3. Download a model checkpoint and place it in `models/Stable-diffusion/`
4. Set the URL in `.env`:
   ```dotenv
   SD_BASE_URL=http://localhost:7860
   SD_MODEL=your-checkpoint-name.safetensors
   ```

### Langfuse (Self-hosted)

The Docker Compose stack starts Langfuse at `http://localhost:3001`.

1. Open http://localhost:3001 in your browser and create an account
2. Navigate to **Settings → API Keys**
3. Create a new key pair and copy both keys into `.env`:
   ```dotenv
   LANGFUSE_SECRET_KEY=sk-lf-...
   LANGFUSE_PUBLIC_KEY=pk-lf-...
   LANGFUSE_HOST=http://localhost:3001
   ```

### PostgreSQL

**Docker one-liner for local development:**

```bash
docker run -d \
  --name koda-postgres \
  -e POSTGRES_DB=koda \
  -e POSTGRES_USER=koda \
  -e POSTGRES_PASSWORD=koda_secret \
  -p 5432:5432 \
  pgvector/pgvector:pg16
```

Connection string format:
```
postgresql://<user>:<password>@<host>:<port>/<database>
```

Example:
```dotenv
DATABASE_URL=postgresql://koda:koda_secret@localhost:5432/koda
```

The `pgvector` extension is required for semantic memory. Use the `pgvector/pgvector:pg16` image (as in Docker Compose) — it includes the extension pre-installed.

### SQLCoder (NL→SQL)

The `nl_to_sql` tool uses the `sqlcoder` model, which must be pulled separately from the main Koda model:

```bash
# Using the Makefile helper
make pull-sqlcoder

# Or directly with Ollama
ollama pull sqlcoder
```

The model is large (several GB). Pull it once and it is cached by Ollama for subsequent runs.
