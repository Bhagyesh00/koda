import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { sessionStore } from '../sessions/store.js';
import { NotFoundError, ValidationError } from '../errors.js';

export const sessionsRouter: Router = Router();

sessionsRouter.get('/sessions', (_req, res) => {
  res.json({
    sessions: sessionStore.list().map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messages.length,
      cwd: s.cwd,
      parentId: s.parentId,
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

const PatchSessionBody = z.object({ title: z.string().min(1).max(200) });

sessionsRouter.patch('/sessions/:id', (req, res) => {
  const body = PatchSessionBody.parse(req.body ?? {});
  const session = sessionStore.get(req.params.id ?? '');
  if (!session) throw new NotFoundError('session');
  sessionStore.setTitle(session.id, body.title);
  res.json({ ok: true });
});

const PatchCwdBody = z.object({ cwd: z.string().min(1) });

sessionsRouter.patch('/sessions/:id/cwd', (req, res) => {
  const session = sessionStore.get(req.params.id ?? '');
  if (!session) throw new NotFoundError('session');
  const { cwd } = PatchCwdBody.parse(req.body ?? {});
  const normalised = validateCwd(cwd);
  sessionStore.setCwd(session.id, normalised);
  res.json({ ok: true, cwd: normalised });
});

const BudgetBody = z.object({ tokenBudget: z.number().int().positive().nullable() });

sessionsRouter.put('/sessions/:id/budget', (req, res) => {
  const session = sessionStore.get(req.params.id ?? '');
  if (!session) throw new NotFoundError('session');
  const { tokenBudget } = BudgetBody.parse(req.body ?? {});
  sessionStore.setTokenBudget(session.id, tokenBudget ?? undefined);
  res.json({ ok: true });
});

const IntentBody = z.object({ intent: z.string().nullable() });

sessionsRouter.put('/sessions/:id/intent', (req, res) => {
  const session = sessionStore.get(req.params.id ?? '');
  if (!session) throw new NotFoundError('session');
  const { intent } = IntentBody.parse(req.body ?? {});
  sessionStore.setPinnedIntent(session.id, intent ?? undefined);
  res.json({ ok: true });
});

const ReplayBody = z.object({
  callId: z.string().min(1),
  newContent: z.string(),
});

sessionsRouter.post('/sessions/:id/replay', (req, res) => {
  const parent = sessionStore.get(req.params.id ?? '');
  if (!parent) throw new NotFoundError('session');
  const { callId, newContent } = ReplayBody.parse(req.body ?? {});

  // Find the tool result message by toolCallId
  const targetIdx = parent.messages.findIndex(
    (m) => m.role === 'tool' && m.toolCallId === callId,
  );
  if (targetIdx < 0) throw new NotFoundError('tool result');

  const child = sessionStore.create({
    title: `Counterfactual of ${parent.title}`,
    cwd: parent.cwd,
    parentId: parent.id,
    branchPoint: targetIdx + 1,
  });

  for (let i = 0; i <= targetIdx; i++) {
    const msg = parent.messages[i]!;
    if (i === targetIdx) {
      sessionStore.appendMessage(child.id, { ...msg, content: newContent });
    } else {
      sessionStore.appendMessage(child.id, { ...msg });
    }
  }
  sessionStore.setGuardrails(child.id, [...(parent.guardrails ?? [])]);

  res.status(201).json(sessionStore.get(child.id)!);
});

const BranchBody = z.object({ branchPoint: z.number().int().min(0) });

sessionsRouter.post('/sessions/:id/branch', (req, res) => {
  const parent = sessionStore.get(req.params.id ?? '');
  if (!parent) throw new NotFoundError('session');
  const { branchPoint } = BranchBody.parse(req.body ?? {});
  const clampedPoint = Math.min(branchPoint, parent.messages.length);

  const child = sessionStore.create({
    title: `Branch of ${parent.title}`,
    cwd: parent.cwd,
    parentId: parent.id,
    branchPoint: clampedPoint,
  });

  // Copy messages up to branchPoint into child session
  const messagesToCopy = parent.messages.slice(0, clampedPoint);
  for (const msg of messagesToCopy) {
    sessionStore.appendMessage(child.id, { ...msg });
  }

  // Copy guardrails from parent
  sessionStore.setGuardrails(child.id, [...(parent.guardrails ?? [])]);

  res.status(201).json(sessionStore.get(child.id)!);
});

// ── Sprint 2: clear / compact / model / export ────────────────────────────────

sessionsRouter.delete('/sessions/:id/messages', (req, res) => {
  const session = sessionStore.get(req.params.id ?? '');
  if (!session) throw new NotFoundError('session');
  sessionStore.clearMessages(session.id);
  res.json({ ok: true });
});

const CompactBody = z.object({ keepLast: z.number().int().positive().max(100).optional() });

sessionsRouter.post('/sessions/:id/compact', (req, res) => {
  const session = sessionStore.get(req.params.id ?? '');
  if (!session) throw new NotFoundError('session');
  const { keepLast } = CompactBody.parse(req.body ?? {});
  sessionStore.compactMessages(session.id, keepLast);
  const updated = sessionStore.get(session.id)!;
  res.json({ ok: true, messageCount: updated.messages.length });
});

const ModelBody = z.object({ model: z.string().min(1).nullable() });

sessionsRouter.patch('/sessions/:id/model', (req, res) => {
  const session = sessionStore.get(req.params.id ?? '');
  if (!session) throw new NotFoundError('session');
  const { model } = ModelBody.parse(req.body ?? {});
  sessionStore.setModel(session.id, model ?? undefined);
  res.json({ ok: true, model: model ?? null });
});

sessionsRouter.get('/sessions/:id/export', (req, res) => {
  const session = sessionStore.get(req.params.id ?? '');
  if (!session) throw new NotFoundError('session');

  const lines: string[] = [
    `# ${session.title}`,
    ``,
    `**Session ID:** ${session.id}  `,
    `**Created:** ${new Date(session.createdAt).toISOString()}  `,
    `**Working Directory:** ${session.cwd ?? 'server default'}  `,
    `**Model:** ${session.model ?? 'default'}`,
    ``,
    `---`,
    ``,
  ];

  for (const msg of session.messages) {
    if (msg.role === 'user') {
      lines.push(`### User`);
      lines.push(``);
      lines.push(msg.content);
      lines.push(``);
    } else if (msg.role === 'assistant') {
      lines.push(`### Assistant`);
      lines.push(``);
      lines.push(msg.content);
      lines.push(``);
    } else if (msg.role === 'tool') {
      lines.push(`> **Tool result** (\`${msg.toolCallId ?? 'unknown'}\`)`);
      lines.push(`>`);
      for (const l of msg.content.slice(0, 500).split('\n')) {
        lines.push(`> ${l}`);
      }
      if (msg.content.length > 500) lines.push(`> … [truncated]`);
      lines.push(``);
    }
  }

  const markdown = lines.join('\n');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="session-${session.id}.md"`);
  res.send(markdown);
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
