import { nanoid } from 'nanoid';
import { RefactorTxArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { sessionStore } from '../sessions/store.js';

export const refactorTxTool: Tool<typeof RefactorTxArgs._type> = {
  name: 'refactor_tx',
  description:
    'Start, update, status, or commit a multi-file refactor transaction. Tracks every file touched so no changes are lost across context boundaries.',
  requiresApproval: false,
  schema: RefactorTxArgs,
  async run(args, ctx) {
    const s = sessionStore.get(ctx.sessionId);
    if (!s) return 'Session not found';

    switch (args.action) {
      case 'start': {
        if (!args.goal) return 'Error: "goal" is required for start';
        const tx = {
          id: nanoid(8),
          goal: args.goal,
          filesPlanned: args.filesPlanned ?? [],
          filesDone: [],
          startedAt: Date.now(),
        };
        sessionStore.setRefactorTx(ctx.sessionId, tx);
        return `Refactor transaction started [${tx.id}]: ${args.goal}\n  ${tx.filesPlanned.length} files planned`;
      }
      case 'status': {
        if (!s.refactorTx) return 'No active refactor transaction';
        const tx = s.refactorTx;
        const pending = tx.filesPlanned.filter((f) => !tx.filesDone.includes(f));
        return (
          `Refactor tx [${tx.id}]: ${tx.goal}\n` +
          `  Done: ${tx.filesDone.length}/${tx.filesPlanned.length}\n` +
          `  Pending: ${pending.join(', ') || '(none)'}`
        );
      }
      case 'add_file': {
        if (!s.refactorTx) return 'No active refactor transaction';
        if (!args.file) return 'Error: "file" is required';
        if (!s.refactorTx.filesPlanned.includes(args.file)) {
          s.refactorTx.filesPlanned.push(args.file);
          sessionStore.setRefactorTx(ctx.sessionId, s.refactorTx);
        }
        return `Added ${args.file} to transaction (${s.refactorTx.filesPlanned.length} total)`;
      }
      case 'mark_done': {
        if (!s.refactorTx) return 'No active refactor transaction';
        if (!args.file) return 'Error: "file" is required';
        if (!s.refactorTx.filesDone.includes(args.file)) {
          s.refactorTx.filesDone.push(args.file);
          sessionStore.setRefactorTx(ctx.sessionId, s.refactorTx);
        }
        const remaining = s.refactorTx.filesPlanned.filter((f) => !s.refactorTx!.filesDone.includes(f));
        return `Marked ${args.file} done. ${remaining.length} files remaining.`;
      }
      case 'commit': {
        if (!s.refactorTx) return 'No active refactor transaction';
        const tx = s.refactorTx;
        const incomplete = tx.filesPlanned.filter((f) => !tx.filesDone.includes(f));
        if (incomplete.length > 0) {
          return `Cannot commit: ${incomplete.length} files incomplete:\n  ${incomplete.join('\n  ')}`;
        }
        sessionStore.setRefactorTx(ctx.sessionId, undefined);
        return `Committed transaction [${tx.id}]: ${tx.filesDone.length} files refactored successfully.`;
      }
      case 'abort': {
        if (!s.refactorTx) return 'No active refactor transaction';
        const id = s.refactorTx.id;
        sessionStore.setRefactorTx(ctx.sessionId, undefined);
        return `Aborted transaction [${id}]`;
      }
    }
    return 'Unknown action';
  },
};
