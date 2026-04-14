import type { ApprovalDecision } from '@koda/shared';

interface Pending<T> {
  resolve: (value: T) => void;
}

class ApprovalQueue {
  private readonly pending = new Map<string, Pending<ApprovalDecision>>();
  private readonly decisions = new Map<string, Pending<{ optionIndex: number }>>();

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

  /** Block until the user picks a decision option. */
  requestDecision(callId: string): Promise<{ optionIndex: number }> {
    return new Promise((resolve) => {
      this.decisions.set(callId, { resolve });
    });
  }

  resolveDecision(callId: string, optionIndex: number): boolean {
    const p = this.decisions.get(callId);
    if (!p) return false;
    this.decisions.delete(callId);
    p.resolve({ optionIndex });
    return true;
  }

  cancel(callId: string): void {
    const p = this.pending.get(callId);
    if (p) {
      this.pending.delete(callId);
      p.resolve({ action: 'deny', reason: 'cancelled' });
    }
    const d = this.decisions.get(callId);
    if (d) {
      this.decisions.delete(callId);
      d.resolve({ optionIndex: 0 });
    }
  }

  has(callId: string): boolean {
    return this.pending.has(callId) || this.decisions.has(callId);
  }
}

export const approvalQueue = new ApprovalQueue();
