import { Router } from 'express';
import { config } from '../config.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  let ollamaOk = false;
  let ollamaError: string | undefined;
  try {
    const r = await fetch(`${config.OLLAMA_BASE_URL.replace(/\/$/, '')}/api/tags`);
    ollamaOk = r.ok;
    if (!r.ok) ollamaError = `status ${r.status}`;
  } catch (e) {
    ollamaError = e instanceof Error ? e.message : String(e);
  }
  res.json({
    ok: true,
    workDir: config.WORK_DIR_ABS,
    model: config.OLLAMA_MODEL,
    ollama: { ok: ollamaOk, error: ollamaError },
  });
});
