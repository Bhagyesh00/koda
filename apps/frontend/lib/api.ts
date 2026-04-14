import type { Session, ApprovalDecision } from '@koda/shared';

// ── Filesystem browsing (Folder Picker) ──────────────────────────────────────

export interface DirectoryListing {
  cwd: string;
  parent: string | null;
  isRoot: boolean;
  entries: Array<{ name: string; path: string }>;
  home: string;
  workDir: string;
  truncated: boolean;
}

export async function listDirectory(p?: string): Promise<DirectoryListing> {
  const qs = p ? `?path=${encodeURIComponent(p)}` : '';
  const r = await fetch(`/api/fs/list${qs}`);
  if (!r.ok) {
    let msg = `failed to list directory (${r.status})`;
    try {
      const data = (await r.json()) as { error?: string; message?: string };
      msg = data.error ?? data.message ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await r.json()) as DirectoryListing;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  cwd?: string;
  parentId?: string;
}

export async function listSessions(): Promise<SessionSummary[]> {
  const r = await fetch('/api/sessions');
  if (!r.ok) throw new Error('failed to list sessions');
  const data = (await r.json()) as { sessions: SessionSummary[] };
  return data.sessions;
}

export interface CreateSessionInput {
  title?: string;
  /** Absolute path to root the session at. If unset, server falls back to its WORK_DIR. */
  cwd?: string;
}

export async function createSession(input: CreateSessionInput = {}): Promise<Session> {
  const r = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    // Surface the validation error from the backend so the UI can show it.
    let message = `failed to create session (${r.status})`;
    try {
      const data = (await r.json()) as { message?: string; error?: string };
      message = data.message ?? data.error ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return (await r.json()) as Session;
}

export async function getSession(id: string): Promise<Session> {
  const r = await fetch(`/api/sessions/${id}`);
  if (!r.ok) throw new Error('failed to load session');
  return (await r.json()) as Session;
}

export async function deleteSession(id: string): Promise<void> {
  await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
}

export async function renameSession(id: string, title: string): Promise<void> {
  const r = await fetch(`/api/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!r.ok) throw new Error(`failed to rename session (${r.status})`);
}

export async function updateSessionCwd(id: string, cwd: string): Promise<string> {
  const r = await fetch(`/api/sessions/${id}/cwd`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cwd }),
  });
  if (!r.ok) {
    let message = `failed to update working directory (${r.status})`;
    try {
      const data = (await r.json()) as { message?: string; error?: string };
      message = data.message ?? data.error ?? message;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  const data = (await r.json()) as { cwd: string };
  return data.cwd;
}

export async function approve(callId: string, decision: ApprovalDecision): Promise<void> {
  await fetch(`/api/approve/${callId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(decision),
  });
}

export interface PlanResponse {
  content: string | null;
  exists: boolean;
  mode: 'plan' | 'build';
}

export async function getPlan(sessionId: string): Promise<PlanResponse> {
  const r = await fetch(`/api/plans/${sessionId}`);
  if (!r.ok) throw new Error('failed to load plan');
  return (await r.json()) as PlanResponse;
}

export async function approvePlan(sessionId: string): Promise<void> {
  const r = await fetch(`/api/plans/${sessionId}/approve`, { method: 'POST' });
  if (!r.ok) throw new Error('failed to approve plan');
}

// ── Guardrails ────────────────────────────────────────────────────────────────

import type { GuardRule } from '@koda/shared';

export async function listGuardrails(sessionId: string): Promise<GuardRule[]> {
  const r = await fetch(`/api/guardrails/${sessionId}`);
  if (!r.ok) throw new Error('failed to load guardrails');
  const d = (await r.json()) as { guardrails: GuardRule[] };
  return d.guardrails;
}

export async function addGuardrail(sessionId: string, rule: Omit<GuardRule, 'id'>): Promise<GuardRule> {
  const r = await fetch(`/api/guardrails/${sessionId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(rule),
  });
  if (!r.ok) throw new Error('failed to add guardrail');
  return (await r.json()) as GuardRule;
}

export async function updateGuardrail(sessionId: string, ruleId: string, patch: Partial<Omit<GuardRule, 'id'>>): Promise<void> {
  await fetch(`/api/guardrails/${sessionId}/${ruleId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export async function deleteGuardrail(sessionId: string, ruleId: string): Promise<void> {
  await fetch(`/api/guardrails/${sessionId}/${ruleId}`, { method: 'DELETE' });
}

export async function resolveDecision(callId: string, optionIndex: number): Promise<void> {
  await fetch(`/api/decide/${callId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ optionIndex }),
  });
}

// ── Peer Review (Phase 27) ────────────────────────────────────────────────────

export interface PeerReviewResult {
  optionA: { label: string; content: string };
  optionB: { label: string; content: string };
}

export async function peerReview(sessionId: string): Promise<PeerReviewResult> {
  const r = await fetch(`/api/sessions/${sessionId}/peer-review`, { method: 'POST' });
  if (!r.ok) throw new Error('failed to run peer review');
  return (await r.json()) as PeerReviewResult;
}

// ── Budget + Intent (Phases 23, 28) ──────────────────────────────────────────

export async function setTokenBudget(sessionId: string, tokenBudget: number | null): Promise<void> {
  const r = await fetch(`/api/sessions/${sessionId}/budget`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tokenBudget }),
  });
  if (!r.ok) throw new Error(`failed to set budget (${r.status})`);
}

export async function setPinnedIntent(sessionId: string, intent: string | null): Promise<void> {
  const r = await fetch(`/api/sessions/${sessionId}/intent`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intent }),
  });
  if (!r.ok) throw new Error(`failed to set intent (${r.status})`);
}

// ── Custom Tools ──────────────────────────────────────────────────────────────

export interface CustomArg {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
}

export interface CustomToolDef {
  name: string;
  description: string;
  requiresApproval: boolean;
  command: string;
  args: CustomArg[];
}

export async function listCustomTools(): Promise<CustomToolDef[]> {
  const r = await fetch('/api/custom-tools');
  if (!r.ok) throw new Error('failed to list custom tools');
  const d = (await r.json()) as { tools: CustomToolDef[] };
  return d.tools;
}

export async function createCustomTool(def: CustomToolDef): Promise<CustomToolDef> {
  const r = await fetch('/api/custom-tools', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(def),
  });
  if (!r.ok) throw new Error('failed to create custom tool');
  return (await r.json()) as CustomToolDef;
}

export async function updateCustomTool(name: string, def: Omit<CustomToolDef, 'name'>): Promise<CustomToolDef> {
  const r = await fetch(`/api/custom-tools/${name}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(def),
  });
  if (!r.ok) throw new Error('failed to update custom tool');
  return (await r.json()) as CustomToolDef;
}

export async function deleteCustomTool(name: string): Promise<void> {
  await fetch(`/api/custom-tools/${name}`, { method: 'DELETE' });
}

// ── Sprint 2: clear / compact / model / export ───────────────────────────────

export async function clearSessionMessages(id: string): Promise<void> {
  const r = await fetch(`/api/sessions/${id}/messages`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`failed to clear session (${r.status})`);
}

export async function compactSession(id: string, keepLast?: number): Promise<number> {
  const r = await fetch(`/api/sessions/${id}/compact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(keepLast !== undefined ? { keepLast } : {}),
  });
  if (!r.ok) throw new Error(`failed to compact session (${r.status})`);
  const d = (await r.json()) as { messageCount: number };
  return d.messageCount;
}

export async function updateSessionModel(id: string, model: string | null): Promise<void> {
  const r = await fetch(`/api/sessions/${id}/model`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model }),
  });
  if (!r.ok) throw new Error(`failed to update model (${r.status})`);
}

export async function updateSessionSkill(id: string, skill: string | null): Promise<void> {
  const r = await fetch(`/api/sessions/${id}/skill`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skill }),
  });
  if (!r.ok) throw new Error(`failed to update skill (${r.status})`);
}

export function exportSessionUrl(id: string): string {
  return `/api/sessions/${id}/export`;
}

// ── Session Branching ─────────────────────────────────────────────────────────

export async function counterfactualReplay(
  sessionId: string,
  callId: string,
  newContent: string,
): Promise<Session> {
  const r = await fetch(`/api/sessions/${sessionId}/replay`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callId, newContent }),
  });
  if (!r.ok) throw new Error('failed to create counterfactual');
  return (await r.json()) as Session;
}

export async function branchSession(sessionId: string, branchPoint: number): Promise<Session> {
  const r = await fetch(`/api/sessions/${sessionId}/branch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ branchPoint }),
  });
  if (!r.ok) throw new Error('failed to branch session');
  return (await r.json()) as Session;
}

// ── Snapshots ─────────────────────────────────────────────────────────────────

export async function listSnapshots(sessionId: string): Promise<Array<{ ref: string; description: string; ts: number }>> {
  const r = await fetch(`/api/sessions/${sessionId}/snapshots`);
  if (!r.ok) throw new Error('failed to load snapshots');
  const d = (await r.json()) as { snapshots: Array<{ ref: string; description: string; ts: number }> };
  return d.snapshots;
}

export async function restoreSnapshot(sessionId: string, ref: string): Promise<void> {
  const r = await fetch(`/api/sessions/${sessionId}/snapshots/restore`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ref }),
  });
  if (!r.ok) throw new Error('failed to restore snapshot');
}
