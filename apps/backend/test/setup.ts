import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Vitest global setup — must run BEFORE any module that touches `config.ts`
 * (which freezes `process.env` at import time). We point WORK_DIR at a fresh
 * tmp directory per test process so test-created sessions, audit logs, memory
 * files, and tech-debt findings can't leak into the real dev workspace.
 *
 * Without this, every `pnpm test` left dozens of "Webhook Session", "Find Me",
 * "Guardrails Test" sessions in apps/backend/workspace/.koda/sessions/ — which
 * then showed up in the dev sidebar.
 */
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'koda-test-'));
process.env.WORK_DIR = tmpRoot;

// Quiet logs so the test runner output stays readable.
process.env.LOG_LEVEL ??= 'fatal';

// Optional: best-effort cleanup at exit. We don't await this — vitest exits
// fast and the OS will recycle /tmp anyway.
process.on('exit', () => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});
