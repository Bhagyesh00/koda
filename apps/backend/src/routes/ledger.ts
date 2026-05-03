import { Router } from 'express';
import { z } from 'zod';
import { sessionStore } from '../sessions/store.js';
import { NotFoundError } from '../errors.js';
import type { Session } from '@koda/shared';

export const ledgerRouter: Router = Router();

/**
 * Decision Ledger — unified projection over the session blob's four
 * decision-shaped arrays (proofs, hypotheses, checkpoints, rejections).
 *
 * This is a *view*, not a persisted table — the data still lives inside the
 * session arrays. Bounded by the existing checkpoint (50) and edit history
 * (200) caps; long-term audit lives in audit/log.ts and will be exposed by
 * the future Phase-5 scanner.
 */
export type DecisionKind = 'proof' | 'hypothesis' | 'checkpoint' | 'rejection';

export interface Decision {
  sessionId: string;
  kind: DecisionKind;
  ts: number;
  summary: string;
  reason?: string;
  raw: unknown;
}

function projectSession(s: Session): Decision[] {
  const out: Decision[] = [];
  for (const p of s.proofs ?? []) {
    out.push({
      sessionId: s.id,
      kind: 'proof',
      ts: p.ts,
      summary: `proof for message ${p.messageId}`,
      reason: p.reason,
      raw: p,
    });
  }
  for (const h of s.hypotheses ?? []) {
    out.push({
      sessionId: s.id,
      kind: 'hypothesis',
      ts: h.ts,
      summary: `${h.result}: ${h.claim}`,
      reason: h.reason,
      raw: h,
    });
  }
  for (const c of s.checkpoints ?? []) {
    out.push({
      sessionId: s.id,
      kind: 'checkpoint',
      ts: c.ts,
      summary: c.summary,
      reason: c.reason,
      raw: c,
    });
  }
  for (const r of s.rejections ?? []) {
    out.push({
      sessionId: s.id,
      kind: 'rejection',
      ts: r.ts,
      summary: `${r.context}: ${r.rejected}`,
      reason: r.reason,
      raw: r,
    });
  }
  return out;
}

const KindSchema = z.enum(['proof', 'hypothesis', 'checkpoint', 'rejection']);
const QuerySchema = z.object({
  q: z.string().optional(),
  kind: KindSchema.optional(),
  since: z.coerce.number().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
});

function applyFilters(
  decisions: Decision[],
  filters: z.infer<typeof QuerySchema>,
): Decision[] {
  let out = decisions;
  if (filters.kind) out = out.filter((d) => d.kind === filters.kind);
  if (filters.since !== undefined) out = out.filter((d) => d.ts >= filters.since!);
  if (filters.q) {
    const needle = filters.q.toLowerCase();
    out = out.filter(
      (d) =>
        d.summary.toLowerCase().includes(needle) ||
        (d.reason?.toLowerCase().includes(needle) ?? false),
    );
  }
  // Newest first.
  out.sort((a, b) => b.ts - a.ts);
  if (filters.limit) out = out.slice(0, filters.limit);
  return out;
}

ledgerRouter.get('/ledger/:sessionId', (req, res) => {
  const filters = QuerySchema.parse(req.query);
  const session = sessionStore.get(req.params.sessionId ?? '');
  if (!session) throw new NotFoundError('session');
  const decisions = applyFilters(projectSession(session), filters);
  res.json({ sessionId: session.id, total: decisions.length, decisions });
});

ledgerRouter.get('/ledger', (req, res) => {
  const filters = QuerySchema.parse(req.query);
  const all: Decision[] = [];
  for (const s of sessionStore.list()) {
    all.push(...projectSession(s));
  }
  const decisions = applyFilters(all, filters);
  res.json({ total: decisions.length, decisions });
});
