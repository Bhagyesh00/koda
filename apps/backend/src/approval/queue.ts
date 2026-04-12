import type { ApprovalDecision } from '@koda/shared';

interface Pending {
  resolve: (decision: ApprovalDecision) => void;
}

class ApprovalQueue {
  private readonly pending = new Map<string, Pending>();

  request(callId: string): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      this.pending.set(callId, { resolve });
    });
  }

  resolve(callId: string, decision: ApprovalDecision): boolean {
    const p = this.pending.get(callId);
    if (!p) return false;
    this.pending.delete(callId);
    p.resolve(decision);
    return true;
  }

  cancel(callId: string): void {
    const p = this.pending.get(callId);
    if (!p) return;
    this.pending.delete(callId);
    p.resolve({ action: 'deny', reason: 'cancelled' });
  }

  has(callId: string): boolean {
    return this.pending.has(callId);
  }
}

export const approvalQueue = new ApprovalQueue();
