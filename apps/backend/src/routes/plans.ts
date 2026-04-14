import fs from 'node:fs/promises';
import { Router } from 'express';
import { sessionStore } from '../sessions/store.js';
import { planFilePath } from '../tools/planWrite.js';
import { NotFoundError } from '../errors.js';
import { config } from '../config.js';

export const plansRouter: Router = Router();

plansRouter.get('/plans/:id', async (req, res) => {
  const id = req.params.id ?? '';
  const session = sessionStore.get(id);
  if (!session) throw new NotFoundError('session');
  const workDir = session.cwd ?? config.WORK_DIR_ABS;
  const file = planFilePath(id, workDir);
  try {
    const content = await fs.readFile(file, 'utf8');
    res.json({ content, exists: true, mode: session.mode });
  } catch {
    res.json({ content: null, exists: false, mode: session.mode });
  }
});

plansRouter.post('/plans/:id/approve', (req, res) => {
  const id = req.params.id ?? '';
  const updated = sessionStore.setMode(id, 'build');
  if (!updated) throw new NotFoundError('session');
  res.json({ ok: true, mode: updated.mode });
});
