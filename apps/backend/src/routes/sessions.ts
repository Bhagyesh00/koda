import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { sessionStore } from '../sessions/store.js';
import { NotFoundError, ValidationError } from '../errors.js';

export const sessionsRouter = Router();

sessionsRouter.get('/sessions', (_req, res) => {
  res.json({
    sessions: sessionStore.list().map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messages.length,
      cwd: s.cwd,
    })),
  });
});

const CreateBody = z.object({
  title: z.string().optional(),
  cwd: z.string().optional(),
});

sessionsRouter.post('/sessions', (req, res) => {
  const body = CreateBody.parse(req.body ?? {});
  const cwd = body.cwd ? validateCwd(body.cwd) : undefined;
  const session = sessionStore.create({ title: body.title, cwd });
  res.status(201).json(session);
});

sessionsRouter.get('/sessions/:id', (req, res) => {
  const session = sessionStore.get(req.params.id ?? '');
  if (!session) throw new NotFoundError('session');
  res.json(session);
});

sessionsRouter.delete('/sessions/:id', (req, res) => {
  const ok = sessionStore.delete(req.params.id ?? '');
  if (!ok) throw new NotFoundError('session');
  res.status(204).end();
});

/**
 * Validate that the requested cwd is an absolute path pointing at an existing
 * directory. Returns the normalized real path.
 */
function validateCwd(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new ValidationError('cwd must be a non-empty path');
  if (!path.isAbsolute(trimmed)) {
    throw new ValidationError(`cwd must be an absolute path (got: ${trimmed})`);
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(trimmed);
  } catch {
    throw new ValidationError(`cwd does not exist: ${trimmed}`);
  }
  if (!stat.isDirectory()) {
    throw new ValidationError(`cwd is not a directory: ${trimmed}`);
  }
  try {
    return fs.realpathSync(trimmed);
  } catch {
    return path.normalize(trimmed);
  }
}
