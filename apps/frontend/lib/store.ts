import { create } from 'zustand';
import type { Todo, SessionMode } from '@koda/shared';

export interface Toast {
  id: string;
  message: string;
  variant: 'info' | 'success' | 'error';
}

export interface HypothesisEntry {
  id: string;
  claim: string;
  result: 'confirmed' | 'refuted' | 'pending';
  actualOutcome?: string;
}

export interface WorkspaceChange {
  files: string[];
  changeType: 'modified' | 'added' | 'deleted';
  ts: number;
}

export type DecisionOption = { label: string; pros: string[]; cons: string[] };

export type DisplayMessage =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean; startedAt: number }
  | { kind: 'thinking'; id: string; messageId: string; text: string }
  | {
      kind: 'tool';
      id: string;
      callId: string;
      tool: string;
      args: unknown;
      requiresApproval: boolean;
      status: 'pending' | 'approved' | 'denied' | 'completed' | 'error';
      output?: string;
    }
  | {
      kind: 'decision';
      id: string;
      callId: string;
      question: string;
      options: DecisionOption[];
      resolved: boolean;
      chosenIndex?: number;
    };

interface ChatState {
  messages: DisplayMessage[];
  todos: Todo[];
  streaming: boolean;
  error: string | null;
  mode: SessionMode;
  planContent: string | null;
  activity: { phase: 'thinking' | 'reading' | 'writing' | 'running' | 'idle'; tool?: string; detail?: string } | null;
  toasts: Toast[];

  // Panel visibility
  guardrailsOpen: boolean;
  contextLensOpen: boolean;
  hypothesisLogOpen: boolean;

  // Context Lens data
  contextFiles: string[];

  // Hypothesis Engine data
  hypotheses: HypothesisEntry[];

  // Workspace watch data
  workspaceChanges: WorkspaceChange[];

  // Live thinking preview (streams during the LLM response)
  liveThinking: { messageId: string; text: string } | null;

  // Phase 28 — Cost meter
  sessionTokens: number;
  turnTokens: number;
  tokenBudget?: number;

  // Phase 23 — Intent
  pinnedIntent: string | null;
  driftWarning: { similarity: number; action: string } | null;

  // Phase 26 — Regret journal
  regrets: Array<{ path: string; editCount: number; timespanMs: number; ts: number }>;

  // Phase 21 — Blast radius (keyed by callId)
  blastRadius: Record<string, { importers: string[]; references: number; tests: string[] }>;

  // Phase 24 — Proof results (keyed by callId)
  proofResults: Record<string, { passed: boolean; output: string }>;

  // Phase 25 — Semantic diffs (keyed by path, latest wins)
  semanticDiffs: Record<string, { summary: string; added: number; removed: number; changed: number }>;

  // Phase 30 — Mental model
  mentalModel: { nodes: Array<{ id: string; kind: 'file' | 'symbol' | 'concept'; label: string; weight: number }>; edges: Array<{ from: string; to: string; kind: 'imports' | 'references' | 'co-accessed' }> };
  mentalModelOpen: boolean;

  // Phase 29 — Memory recall
  memoryRecall: Array<{ sessionId: string; excerpt: string; score: number; ts: number }>;

  // Sprint 2 — Test results (keyed by callId)
  testResults: Record<string, { runner: string; passed: number; failed: number; skipped: number; duration?: string; failures: Array<{ name: string; message: string }> }>;

  /** When true every tool call is auto-approved without a user confirmation prompt. */
  autoAccept: boolean;
  setAutoAccept: (v: boolean) => void;

  setStreaming: (v: boolean) => void;
  setError: (e: string | null) => void;
  reset: (initial: DisplayMessage[]) => void;
  appendUser: (text: string) => void;
  startAssistant: (id: string) => void;
  appendAssistantDelta: (id: string, text: string) => void;
  endAssistant: (id: string) => void;
  addToolRequest: (
    callId: string,
    tool: string,
    args: unknown,
    requiresApproval: boolean,
  ) => void;
  setToolStatus: (callId: string, status: 'approved' | 'denied') => void;
  setToolResult: (callId: string, ok: boolean, output: string) => void;
  setTodos: (todos: Todo[]) => void;
  setMode: (m: SessionMode) => void;
  setPlanContent: (c: string | null) => void;
  addThinking: (messageId: string, text: string) => void;
  setActivity: (a: ChatState['activity']) => void;
  addToast: (message: string, variant?: Toast['variant']) => void;
  removeToast: (id: string) => void;

  // Panel toggles
  setGuardrailsOpen: (v: boolean) => void;
  setContextLensOpen: (v: boolean) => void;
  setHypothesisLogOpen: (v: boolean) => void;

  // Decision mode
  addDecision: (callId: string, question: string, options: DecisionOption[]) => void;
  resolveDecisionCard: (callId: string, chosenIndex: number) => void;

  // Context lens
  setContextFiles: (files: string[]) => void;

  // Hypothesis engine
  updateHypothesisEntry: (
    id: string,
    result: 'confirmed' | 'refuted' | 'pending',
    actualOutcome?: string,
  ) => void;
  addHypothesisEntry: (entry: HypothesisEntry) => void;

  // Workspace watch
  addWorkspaceChange: (change: Omit<WorkspaceChange, 'ts'>) => void;
  clearWorkspaceChanges: () => void;

  // Live thinking
  setLiveThinking: (messageId: string, text: string) => void;
  finalizeLiveThinking: () => void;

  // Phase 28 — Cost
  setCostUpdate: (turnTokens: number, sessionTokens: number, budget?: number) => void;
  setTokenBudgetLocal: (budget: number | undefined) => void;
  resetCost: () => void;

  // Phase 23 — Intent
  setPinnedIntentLocal: (intent: string | null) => void;
  setDriftWarning: (warning: { similarity: number; action: string } | null) => void;

  // Phase 26 — Regret
  addRegret: (r: { path: string; editCount: number; timespanMs: number }) => void;

  // Phase 21 — Blast radius
  setBlastRadius: (callId: string, data: { importers: string[]; references: number; tests: string[] }) => void;

  // Phase 24 — Proof
  setProofResult: (callId: string, passed: boolean, output: string) => void;

  // Phase 25 — Semantic diff
  setSemanticDiff: (path: string, summary: string, added: number, removed: number, changed: number) => void;

  // Phase 30 — Mental model
  setMentalModel: (nodes: ChatState['mentalModel']['nodes'], edges: ChatState['mentalModel']['edges']) => void;
  setMentalModelOpen: (v: boolean) => void;

  // Phase 29 — Memory
  setMemoryRecall: (matches: ChatState['memoryRecall']) => void;

  // Sprint 2 — Test results
  addTestResult: (callId: string, result: ChatState['testResults'][string]) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  todos: [],
  streaming: false,
  error: null,
  mode: 'build',
  planContent: null,
  activity: null,
  toasts: [],
  guardrailsOpen: false,
  contextLensOpen: false,
  hypothesisLogOpen: false,
  contextFiles: [],
  hypotheses: [],
  workspaceChanges: [],
  liveThinking: null,
  sessionTokens: 0,
  turnTokens: 0,
  tokenBudget: undefined,
  pinnedIntent: null,
  driftWarning: null,
  regrets: [],
  blastRadius: {},
  proofResults: {},
  semanticDiffs: {},
  mentalModel: { nodes: [], edges: [] },
  mentalModelOpen: false,
  memoryRecall: [],
  testResults: {},

  autoAccept: false,
  setAutoAccept: (v) => set({ autoAccept: v }),

  setStreaming: (v) => set({ streaming: v }),
  setError: (e) => set({ error: e }),

  reset: (initial) =>
    set({
      messages: initial,
      todos: [],
      error: null,
      planContent: null,
      activity: null,
      contextFiles: [],
      hypotheses: [],
      workspaceChanges: [],
      liveThinking: null,
      sessionTokens: 0,
      turnTokens: 0,
      tokenBudget: undefined,
      pinnedIntent: null,
      driftWarning: null,
      regrets: [],
      blastRadius: {},
      proofResults: {},
      semanticDiffs: {},
      mentalModel: { nodes: [], edges: [] },
      memoryRecall: [],
      testResults: {},
    }),

  appendUser: (text) =>
    set((s) => ({
      messages: [...s.messages, { kind: 'user', id: crypto.randomUUID(), text }],
    })),

  startAssistant: (id) =>
    set((s) => ({
      messages: [
        ...s.messages,
        { kind: 'assistant', id, text: '', streaming: true, startedAt: Date.now() },
      ],
    })),

  appendAssistantDelta: (id, text) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.kind === 'assistant' && m.id === id ? { ...m, text: m.text + text } : m,
      ),
    })),

  endAssistant: (id) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.kind === 'assistant' && m.id === id ? { ...m, streaming: false } : m,
      ),
    })),

  addToolRequest: (callId, tool, args, requiresApproval) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          kind: 'tool',
          id: crypto.randomUUID(),
          callId,
          tool,
          args,
          requiresApproval,
          status: requiresApproval ? 'pending' : 'approved',
        },
      ],
    })),

  setToolStatus: (callId, status) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.kind === 'tool' && m.callId === callId ? { ...m, status } : m,
      ),
    })),

  setToolResult: (callId, ok, output) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.kind === 'tool' && m.callId === callId
          ? { ...m, status: ok ? 'completed' : 'error', output }
          : m,
      ),
    })),

  setTodos: (todos) => set({ todos }),
  setMode: (m) => set({ mode: m }),
  setPlanContent: (c) => set({ planContent: c }),

  addThinking: (messageId, text) =>
    set((s) => {
      const block = { kind: 'thinking' as const, id: crypto.randomUUID(), messageId, text };
      // Insert BEFORE the assistant message this thinking belongs to, so the
      // ThinkingBlock appears above the response rather than below it.
      const idx = s.messages.findIndex((m) => m.kind === 'assistant' && m.id === messageId);
      if (idx === -1) return { messages: [...s.messages, block] };
      return {
        messages: [
          ...s.messages.slice(0, idx),
          block,
          ...s.messages.slice(idx),
        ],
      };
    }),

  setActivity: (a) => set({ activity: a }),

  addToast: (message, variant = 'info') =>
    set((s) => ({
      toasts: [...s.toasts, { id: crypto.randomUUID(), message, variant }],
    })),

  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setGuardrailsOpen: (v) => set({ guardrailsOpen: v }),
  setContextLensOpen: (v) => set({ contextLensOpen: v }),
  setHypothesisLogOpen: (v) => set({ hypothesisLogOpen: v }),

  addDecision: (callId, question, options) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          kind: 'decision',
          id: crypto.randomUUID(),
          callId,
          question,
          options,
          resolved: false,
        },
      ],
    })),

  resolveDecisionCard: (callId, chosenIndex) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.kind === 'decision' && m.callId === callId
          ? { ...m, resolved: true, chosenIndex }
          : m,
      ),
    })),

  setContextFiles: (files) =>
    set((s) => ({
      contextFiles: [...new Set([...s.contextFiles, ...files])],
    })),

  updateHypothesisEntry: (id, result, actualOutcome) =>
    set((s) => ({
      hypotheses: s.hypotheses.map((h) =>
        h.id === id ? { ...h, result, actualOutcome: actualOutcome ?? h.actualOutcome } : h,
      ),
    })),

  addHypothesisEntry: (entry) =>
    set((s) => ({ hypotheses: [...s.hypotheses, entry] })),

  addWorkspaceChange: (change) =>
    set((s) => ({
      workspaceChanges: [{ ...change, ts: Date.now() }, ...s.workspaceChanges].slice(0, 50),
    })),

  clearWorkspaceChanges: () => set({ workspaceChanges: [] }),

  setLiveThinking: (messageId, text) => set({ liveThinking: { messageId, text } }),
  finalizeLiveThinking: () => set({ liveThinking: null }),

  setCostUpdate: (turnTokens, sessionTokens, budget) =>
    set({ turnTokens, sessionTokens, tokenBudget: budget }),
  setTokenBudgetLocal: (budget) => set({ tokenBudget: budget }),
  resetCost: () => set({ sessionTokens: 0, turnTokens: 0 }),

  setPinnedIntentLocal: (intent) => set({ pinnedIntent: intent }),
  setDriftWarning: (warning) => set({ driftWarning: warning }),

  addRegret: (r) =>
    set((s) => ({ regrets: [{ ...r, ts: Date.now() }, ...s.regrets].slice(0, 50) })),

  setBlastRadius: (callId, data) =>
    set((s) => ({ blastRadius: { ...s.blastRadius, [callId]: data } })),

  setProofResult: (callId, passed, output) =>
    set((s) => ({ proofResults: { ...s.proofResults, [callId]: { passed, output } } })),

  setSemanticDiff: (path, summary, added, removed, changed) =>
    set((s) => ({
      semanticDiffs: { ...s.semanticDiffs, [path]: { summary, added, removed, changed } },
    })),

  setMentalModel: (nodes, edges) => set({ mentalModel: { nodes, edges } }),
  setMentalModelOpen: (v) => set({ mentalModelOpen: v }),

  setMemoryRecall: (matches) => set({ memoryRecall: matches }),

  addTestResult: (callId, result) =>
    set((s) => ({ testResults: { ...s.testResults, [callId]: result } })),
}));
