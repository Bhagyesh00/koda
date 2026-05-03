import { Router } from 'express';
import { config } from '../config.js';

export const healthRouter: Router = Router();

const OLLAMA_PROBE_TIMEOUT_MS = 1500;

healthRouter.get('/health', async (_req, res) => {
  let ollamaOk = false;
  let ollamaError: string | undefined;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), OLLAMA_PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(`${config.OLLAMA_BASE_URL.replace(/\/$/, '')}/api/tags`, {
      signal: ac.signal,
    });
    ollamaOk = r.ok;
    if (!r.ok) ollamaError = `status ${r.status}`;
  } catch (e) {
    ollamaError = ac.signal.aborted
      ? `unreachable (timeout ${OLLAMA_PROBE_TIMEOUT_MS}ms)`
      : e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(timer);
  }
  res.json({
    ok: true,
    workDir: config.WORK_DIR_ABS,
    model: config.OLLAMA_MODEL,
    ollama: { ok: ollamaOk, error: ollamaError },
  });
});
