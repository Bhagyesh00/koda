# Koda — automation
# Cross-shell Makefile (works in PowerShell, cmd, and bash).
# Usage: `make <target>`. Run `make help` to list targets.

.DEFAULT_GOAL := help

# ---- config ----
ifeq ($(OS),Windows_NT)
  PNPM   ?= cmd /c pnpm
  OLLAMA ?= cmd /c ollama
else
  PNPM   ?= pnpm
  OLLAMA ?= ollama
endif
OLLAMA_MODEL ?= gemma4:e4b
BACKEND_PORT ?= 4001
FRONTEND_PORT?= 4000
ENV_FILE     ?= .env

# ---- meta ----
.PHONY: help
help:
	@node -e "const fs=require('fs');const lines=fs.readFileSync('Makefile','utf8').split(/\r?\n/);for(const l of lines){const m=l.match(/^([a-zA-Z_-]+):.*?##\s*(.*)$$/);if(m)console.log('  \x1b[36m'+m[1].padEnd(16)+'\x1b[0m '+m[2]);}"

# ---- setup ----
.PHONY: setup
setup: env install ## First-run setup: copy .env, install deps

.PHONY: env
env: ## Copy .env.example -> .env if missing
	@node -e "const fs=require('fs');if(!fs.existsSync('.env')){fs.copyFileSync('.env.example','.env');console.log('Created .env -- edit AUTH_TOKEN and OLLAMA_MODEL if needed');}else{console.log('.env already exists');}"

.PHONY: install
install: ## Install all workspace deps via pnpm
	$(PNPM) install

# ---- ollama ----
.PHONY: pull-model
pull-model: ## Pull the configured Ollama model
	$(OLLAMA) pull $(OLLAMA_MODEL)

.PHONY: ollama-serve
ollama-serve: ## Start the Ollama server in foreground
	$(OLLAMA) serve

.PHONY: ollama-check
ollama-check: ## Check that Ollama is reachable
	@node -e "fetch('http://localhost:11434/api/tags').then(r=>{if(r.ok){console.log('ollama: OK');}else{console.log('ollama: status '+r.status);process.exit(1);}}).catch(e=>{console.log('ollama: NOT REACHABLE -- run \"make ollama-serve\" in another terminal');process.exit(1);})"

.PHONY: list-models
list-models: ## List installed Ollama models
	$(OLLAMA) list

# ---- dev ----
.PHONY: dev
dev: ## Run backend + frontend in parallel (foreground)
	$(PNPM) dev

# ---- start / stop (Windows: spawns labelled cmd windows) ----
.PHONY: start
start: ## Launch Ollama + Koda in two background cmd windows
	@node scripts/start.mjs

.PHONY: stop
stop: ## Close the cmd windows started by 'make start'
	@node scripts/stop.mjs

.PHONY: restart
restart: stop start ## Stop and start again

.PHONY: logs
logs: ## Show last 40 lines of backend + frontend + ollama logs
	@node -e "const fs=require('fs');for(const f of ['logs/backend.log','logs/frontend.log','logs/ollama.log']){console.log('\\n=== '+f+' ===');try{const t=fs.readFileSync(f,'utf8').split(/\\r?\\n/).slice(-40).join('\\n');console.log(t||'(empty)');}catch{console.log('(no log yet)');}}"

.PHONY: logs-backend
logs-backend: ## Tail logs/backend.log
	@node -e "const fs=require('fs');try{console.log(fs.readFileSync('logs/backend.log','utf8'));}catch{console.log('(no log)');}"

.PHONY: logs-frontend
logs-frontend: ## Tail logs/frontend.log
	@node -e "const fs=require('fs');try{console.log(fs.readFileSync('logs/frontend.log','utf8'));}catch{console.log('(no log)');}"

.PHONY: status
status: ## Show whether backend + ollama are reachable
	@node -e "Promise.all([fetch('http://localhost:11434/api/tags').then(r=>r.ok).catch(()=>false),fetch('http://localhost:$(BACKEND_PORT)/v1/health').then(r=>r.ok).catch(()=>false)]).then(([o,b])=>{console.log('ollama  : '+(o?'UP':'DOWN'));console.log('backend : '+(b?'UP':'DOWN'));})"

.PHONY: dev-backend
dev-backend: ## Run backend only (watch mode)
	$(PNPM) --filter @koda/backend dev

.PHONY: dev-frontend
dev-frontend: ## Run frontend only
	$(PNPM) --filter @koda/frontend dev

# ---- build ----
.PHONY: build
build: ## Build all workspaces
	$(PNPM) build

.PHONY: build-backend
build-backend: ## Build backend only
	$(PNPM) --filter @koda/backend build

.PHONY: build-frontend
build-frontend: ## Build frontend only
	$(PNPM) --filter @koda/frontend build

# ---- quality ----
.PHONY: typecheck
typecheck: ## Typecheck all workspaces
	$(PNPM) typecheck

.PHONY: lint
lint: ## Lint all workspaces
	$(PNPM) lint

.PHONY: test
test: ## Run all tests (vitest)
	$(PNPM) test

.PHONY: check
check: typecheck lint test ## Run typecheck + lint + test

# ---- runtime helpers ----
.PHONY: health
health: ## Hit the backend /v1/health endpoint
	@node -e "fetch('http://localhost:$(BACKEND_PORT)/v1/health').then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,2))).catch(e=>{console.error('backend not reachable:',e.message);process.exit(1);})"

.PHONY: audit-tail
audit-tail: ## Tail the tool-execution audit log
	@node -e "const fs=require('fs'),p='.koda/audit.log';if(!fs.existsSync(p)){console.log('(no audit log yet)');process.exit(0);}let pos=fs.statSync(p).size;process.stdout.write(fs.readFileSync(p,'utf8'));fs.watchFile(p,{interval:500},(c)=>{if(c.size>pos){const fd=fs.openSync(p,'r');const buf=Buffer.alloc(c.size-pos);fs.readSync(fd,buf,0,buf.length,pos);fs.closeSync(fd);process.stdout.write(buf.toString());pos=c.size;}});"

# ---- cleanup ----
.PHONY: clean
clean: ## Remove build outputs
	@node -e "const fs=require('fs');for(const p of ['apps/backend/dist','apps/frontend/.next','apps/frontend/out','packages/shared/dist']){fs.rmSync(p,{recursive:true,force:true});console.log('removed '+p);}"

.PHONY: clean-all
clean-all: clean ## Remove build outputs AND node_modules
	@node -e "const fs=require('fs'),path=require('path');function walk(d){if(!fs.existsSync(d))return;for(const e of fs.readdirSync(d,{withFileTypes:true})){if(!e.isDirectory())continue;const p=path.join(d,e.name);if(e.name==='node_modules'){fs.rmSync(p,{recursive:true,force:true});console.log('removed '+p);}else if(e.name!=='.git'){walk(p);}}}walk('.');"

.PHONY: reset
reset: clean-all install ## Nuke + reinstall everything
