import { Router } from 'express';
import { z } from 'zod';
import { approvalQueue } from '../approval/queue.js';
import { NotFoundError } from '../errors.js';

export const approvalRouter = Router();

const ApprovalBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), args: z.unknown().optional() }),
  z.object({ action: z.literal('deny'), reason: z.string().optional() }),
]);

approvalRouter.post('/approve/:callId', (req, res) => {
  const callId = req.params.callId ?? '';
  const decision = ApprovalBody.parse(req.body);
  const ok = approvalQueue.resolve(callId, decision);
  if (!ok) throw new NotFoundError('pending approval');
  res.json({ ok: true });
});
