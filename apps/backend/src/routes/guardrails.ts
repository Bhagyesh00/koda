import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { GuardRuleSchema } from '@koda/shared';
import { sessionStore } from '../sessions/store.js';
import { NotFoundError } from '../errors.js';

export const guardrailsRouter: Router = Router();

guardrailsRouter.get('/sessions/:id/guardrails', (req, res) => {
  const session = sessionStore.get(req.params.id ?? '');
  if (!session) throw new NotFoundError('session');
  res.json({ guardrails: session.guardrails });
});

const CreateRuleBody = GuardRuleSchema.omit({ id: true });

guardrailsRouter.post('/sessions/:id/guardrails', (req, res) => {
  const session = sessionStore.get(req.params.id ?? '');
  if (!session) throw new NotFoundError('session');
  const body = CreateRuleBody.parse(req.body ?? {});
  const rule = { ...body, id: nanoid(8) };
  sessionStore.setGuardrails(session.id, [...session.guardrails, rule]);
  res.status(201).json(rule);
});

guardrailsRouter.patch('/sessions/:id/guardrails/:ruleId', (req, res) => {
  const session = sessionStore.get(req.params.id ?? '');
  if (!session) throw new NotFoundError('session');
  const PatchBody = GuardRuleSchema.partial().omit({ id: true });
  const body = PatchBody.parse(req.body ?? {});
  const updated = session.guardrails.map((r) =>
    r.id === req.params.ruleId ? { ...r, ...body } : r,
  );
  sessionStore.setGuardrails(session.id, updated);
  res.json({ ok: true });
});

guardrailsRouter.delete('/sessions/:id/guardrails/:ruleId', (req, res) => {
  const session = sessionStore.get(req.params.id ?? '');
  if (!session) throw new NotFoundError('session');
  const filtered = session.guardrails.filter((r) => r.id !== req.params.ruleId);
  sessionStore.setGuardrails(session.id, filtered);
  res.status(204).end();
});
