import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import { sessionStore } from '../../sessions/store.js';
import { runCommand } from '../../sandbox/exec.js';
import { parseTestOutput } from '../../sandbox/testParser.js';
import { computeSemanticDiff } from '../semanticDiff.js';
import { STAGE_KEYS, type TurnState, type ToolCallCtx } from './types.js';
import type { SSEWriter } from '../../sse.js';

const THRASH_WINDOW_MS = 10 * 60_000;
const THRASH_COUNT = 3;

function hashContent(file: string): string {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
  } catch {
    return 'unknown';
  }
}

/**
 * Sprint 2 — Test result parsing.
 * After a bash call succeeds, attempts to parse the output as a test runner
 * result (Jest/Vitest/Mocha/etc.) and emits test_results if recognised.
 */
export function runTestResults(ctx: ToolCallCtx): void {
  const { tool, finalArgs, output, ok, callId, sse } = ctx;
  if (!ok || tool.name !== 'bash') return;
  const bashCmd = (finalArgs as { command?: string }).command ?? '';
  const testResult = parseTestOutput(bashCmd, output, '');
  if (testResult) {
    sse.send({
      type: 'test_results',
      callId,
      runner: testResult.runner,
      passed: testResult.passed,
      failed: testResult.failed,
      skipped: testResult.skipped,
      duration: testResult.duration,
      failures: testResult.failures,
    });
  }
}

/**
 * Phase 24 — Proof-carrying changes: verification.
 * After a mutation tool (write_file, edit_file, bash) succeeds, runs the
 * pending proof command and emits proof_result.  Clears pendingProof.
 */
export async function runProofVerify(ctx: ToolCallCtx): Promise<void> {
  const { ok, tool, workDir, callId, sessionId, sse, turn } = ctx;
  if (!ok || !turn.pendingProof) return;
  if (
    tool.name !== 'write_file' &&
    tool.name !== 'edit_file' &&
    tool.name !== 'bash'
  ) {
    return;
  }
  const proof = turn.pendingProof;
  turn.pendingProof = null;
  try {
    const verifyResult = await runCommand(proof.command, workDir, { timeoutMs: 60_000 });
    const passed = verifyResult.exitCode === 0;
    sse.send({ type: 'proof_result', callId, passed, output: verifyResult.output.slice(0, 500) });
    if (!passed) {
      sessionStore.appendMessage(sessionId, {
        id: nanoid(8),
        role: 'tool',
        content: `Proof FAILED: "${proof.description}" — ${verifyResult.output.slice(0, 300)}`,
        toolCallId: callId,
        createdAt: Date.now(),
      });
    }
  } catch {
    /* ignore proof errors — proof failure doesn't block the turn */
  }
}

/**
 * Phase 25 — Semantic diff comparison.
 * Reads the "before" snapshot stored by captureSemanticBefore() and compares
 * it against the file as it exists after execution.
 */
export function runSemanticDiffCompare(ctx: ToolCallCtx): void {
  const { ok, workDir, sse, stageState } = ctx;
  if (!ok) return;
  const stored = stageState.get(STAGE_KEYS.SEMANTIC_DIFF_BEFORE) as
    | { before: string; targetPath: string }
    | undefined;
  if (!stored) return;
  try {
    const abs = path.isAbsolute(stored.targetPath)
      ? stored.targetPath
      : path.join(workDir, stored.targetPath);
    const after = fs.readFileSync(abs, 'utf8');
    const diff = computeSemanticDiff(stored.before, after);
    sse.send({
      type: 'semantic_diff',
      path: stored.targetPath,
      summary: diff.summary,
      added: diff.added,
      removed: diff.removed,
      changed: diff.changed,
    });
  } catch {
    /* best-effort — ignore read/diff errors */
  }
}

/**
 * Phase 26 — Regret journal / thrashing detection.
 * After each write_file or edit_file, records the edit and checks whether the
 * same file has been edited too many times or the content is oscillating.
 */
export function runRegretJournal(ctx: ToolCallCtx): void {
  const { ok, tool, finalArgs, sessionId, workDir, sse } = ctx;
  if (!ok || (tool.name !== 'write_file' && tool.name !== 'edit_file')) return;
  const editedPath = (finalArgs as { path?: string }).path;
  if (!editedPath) return;

  const absPath = path.isAbsolute(editedPath)
    ? editedPath
    : path.join(workDir, editedPath);
  const contentHash = hashContent(absPath);
  sessionStore.recordEdit(sessionId, { path: editedPath, ts: Date.now(), contentHash });

  const s = sessionStore.get(sessionId);
  if (!s) return;
  const recentEdits = (s.editHistory ?? []).filter(
    (e) => e.path === editedPath && Date.now() - e.ts <= THRASH_WINDOW_MS,
  );
  const hashCounts = new Map<string, number>();
  for (const e of recentEdits) {
    hashCounts.set(e.contentHash, (hashCounts.get(e.contentHash) ?? 0) + 1);
  }
  const oscillating = Array.from(hashCounts.values()).some((c) => c >= 2);
  if (recentEdits.length >= THRASH_COUNT || oscillating) {
    sse.send({
      type: 'regret_detected',
      path: editedPath,
      editCount: recentEdits.length,
      timespanMs: THRASH_WINDOW_MS,
    });
  }
}

/**
 * Phase 24 — Hypothesis auto-verify (inline, after bash).
 * When a bash call succeeds and there is a pending hypothesis, immediately
 * runs the verification command and emits hypothesis_update.
 */
export async function runHypothesisVerify(ctx: ToolCallCtx): Promise<void> {
  const { ok, tool, workDir, sessionId, sse, turn } = ctx;
  if (tool.name !== 'bash' || !ok || !turn.pendingHypothesis) return;
  const hyp = turn.pendingHypothesis;
  turn.pendingHypothesis = null;
  try {
    const verifyResult = await runCommand(hyp.verification, workDir, { timeoutMs: 30_000 });
    const confirmed = verifyResult.exitCode === 0;
    sessionStore.updateHypothesis(
      sessionId,
      hyp.id,
      confirmed ? 'confirmed' : 'refuted',
      verifyResult.output.slice(0, 500),
    );
    sse.send({
      type: 'hypothesis_update',
      id: hyp.id,
      result: confirmed ? 'confirmed' : 'refuted',
      actualOutcome: verifyResult.output.slice(0, 200),
    });
  } catch {
    /* leave hypothesis as pending if verification command fails */
  }
}

/**
 * Phase 24 — Hypothesis auto-verify (turn-end fallback).
 * If the loop completed without a bash call, the hypothesis was never
 * verified inline.  Run it now so it doesn't stay permanently pending.
 */
export async function verifyPendingHypothesisAtTurnEnd(
  sessionId: string,
  workDir: string,
  turn: TurnState,
  sse: SSEWriter,
): Promise<void> {
  if (!turn.pendingHypothesis) return;
  const hyp = turn.pendingHypothesis;
  turn.pendingHypothesis = null;
  try {
    const verifyResult = await runCommand(hyp.verification, workDir, { timeoutMs: 30_000 });
    const confirmed = verifyResult.exitCode === 0;
    sessionStore.updateHypothesis(
      sessionId,
      hyp.id,
      confirmed ? 'confirmed' : 'refuted',
      verifyResult.output.slice(0, 500),
    );
    sse.send({
      type: 'hypothesis_update',
      id: hyp.id,
      result: confirmed ? 'confirmed' : 'refuted',
      actualOutcome: verifyResult.output.slice(0, 200),
    });
  } catch {
    /* leave hypothesis result as-is */
  }
}

/** Emits todo_update after a todo_write call. */
export function emitTodoUpdate(ctx: ToolCallCtx): void {
  const { tool, sessionId, sse } = ctx;
  if (tool.name !== 'todo_write') return;
  const s = sessionStore.get(sessionId);
  if (s) sse.send({ type: 'todo_update', todos: s.todos });
}

/** Emits plan_update after a successful plan_write call. */
export function emitPlanUpdate(ctx: ToolCallCtx): void {
  const { tool, finalArgs, ok, sse } = ctx;
  if (tool.name !== 'plan_write' || !ok) return;
  const content = (finalArgs as { content: string }).content;
  sse.send({ type: 'plan_update', content });
}
