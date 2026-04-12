import { create } from 'zustand';
import type { Todo, SessionMode } from '@koda/shared';

export type DisplayMessage =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | {
      kind: 'tool';
      id: string;
      callId: string;
      tool: string;
      args: unknown;
      requiresApproval: boolean;
      status: 'pending' | 'approved' | 'denied' | 'completed' | 'error';
      output?: string;
    };

interface ChatState {
  messages: DisplayMessage[];
  todos: Todo[];
  streaming: boolean;
  error: string | null;
  mode: SessionMode;
  planContent: string | null;
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
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  todos: [],
  streaming: false,
  error: null,
  mode: 'build',
  planContent: null,

  setStreaming: (v) => set({ streaming: v }),
  setError: (e) => set({ error: e }),

  reset: (initial) =>
    set({ messages: initial, todos: [], error: null, planContent: null }),

  appendUser: (text) =>
    set((s) => ({
      messages: [...s.messages, { kind: 'user', id: crypto.randomUUID(), text }],
    })),

  startAssistant: (id) =>
    set((s) => ({
      messages: [...s.messages, { kind: 'assistant', id, text: '', streaming: true }],
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
}));
