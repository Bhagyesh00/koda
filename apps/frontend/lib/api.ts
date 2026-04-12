import type { Session, ApprovalDecision } from '@koda/shared';

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  cwd?: string;
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
