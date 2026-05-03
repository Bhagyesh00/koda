import type { ServerEvent, SessionMode, Todo } from '@koda/shared';
import { useChatStore } from './store';
import { partitionThinking } from './thinkingParser';
import type { ChatStreamHandlers } from './sseClient';

/**
 * Action bag the SSE handler invokes for every event type. Decouples the giant
 * `switch (ev.type)` from the React page so the handler is testable in
 * isolation and reusable from a hypothetical SSR proxy / alternate UI.
 *
 * All callers should fill this from the page's existing useChatStore selectors —
 * see `defaultActionsFromStore()` for a one-liner that does that.
 */
export interface ChatStreamActions {
  startAssistant: (id: string) => void;
  appendAssistantDelta: (id: string, text: string) => void;
  endAssistant: (id: string) => void;
  addThinking: (messageId: string, text: string) => void;
  setActivity: (a: { phase: 'thinking' | 'reading' | 'writing' | 'running' | 'idle'; tool?: string; detail?: string } | null) => void;
  addToolRequest: (callId: string, tool: string, args: unknown, requiresApproval: boolean) => void;
  setToolResult: (callId: string, ok: boolean, output: string) => void;
  setTodos: (todos: Todo[]) => void;
  setPlanContent: (c: string | null) => void;
  setMode: (m: SessionMode) => void;
  addToast: (msg: string, variant?: 'info' | 'success' | 'error') => void;
  addDecision: (callId: string, question: string, options: Array<{ label: string; pros: string[]; cons: string[] }>) => void;
  setContextFiles: (files: string[]) => void;
  updateHypothesisEntry: (id: string, result: 'confirmed' | 'refuted' | 'pending', actualOutcome?: string) => void;
  setError: (e: string | null) => void;
  setStreaming: (v: boolean) => void;
  addWorkspaceChange: (c: { files: string[]; changeType: 'modified' | 'added' | 'deleted' }) => void;
}

export interface CreateChatStreamHandlerOptions {
  actions: ChatStreamActions;
  /**
   * Called when the stream ends cleanly (the `done` event arrives). The page
   * uses this to clear ephemeral UI state. Distinct from `onClose` on the
   * stream itself, which fires on any termination including errors.
   */
  onDone?: () => void;
}

/**
 * Build a `ChatStreamHandlers` value with the giant per-event switch broken
 * into one private function per case. Internal buffers (per-message text
 * accumulator, thinking-promotion guard) are encapsulated here — the page no
 * longer has to keep its own refs.
 *
 * Why a factory and not just an exported function: every chat send creates a
 * fresh handler with fresh internal state. This avoids the mid-stream reuse
 * bugs where leftover buffers from one turn leak into the next.
 */
export function createChatStreamHandler(opts: CreateChatStreamHandlerOptions): ChatStreamHandlers {
  const { actions, onDone } = opts;

  // Per-message text accumulator — needed so we can recompute liveThinking on
  // every delta (the parser is cumulative, not incremental).
  const messageBuffers = new Map<string, string>();
  // Tracks which messageIds have already had their thinking promoted to a
  // permanent block. Prevents the canonical `thinking` SSE from double-emitting
  // a block we already promoted from the delta stream.
  const thinkingReceived = new Set<string>();

  const dispatch = (ev: ServerEvent): void => {
    switch (ev.type) {
      case 'message_start': {
        actions.startAssistant(ev.messageId);
        messageBuffers.set(ev.messageId, '');
        break;
      }

      case 'delta': {
        actions.appendAssistantDelta(ev.messageId, ev.text);
        const prev = messageBuffers.get(ev.messageId) ?? '';
        const next = prev + ev.text;
        messageBuffers.set(ev.messageId, next);
        const { liveThinking } = partitionThinking(next);
        if (liveThinking) {
          useChatStore.getState().setLiveThinking(ev.messageId, liveThinking);
        }
        // Promote thinking to a permanent block as soon as </think> closes —
        // catches the case where the canonical `thinking` SSE arrives late or
        // never (older Ollama models don't emit a separate thinking field).
        if (!thinkingReceived.has(ev.messageId) && next.includes('</think>')) {
          const m = next.match(/<think>([\s\S]*?)<\/think>/);
          if (m?.[1]?.trim()) {
            thinkingReceived.add(ev.messageId);
            actions.addThinking(ev.messageId, m[1].trim());
            useChatStore.getState().finalizeLiveThinking();
          }
        }
        break;
      }

      case 'message_end': {
        actions.endAssistant(ev.messageId);
        // Promote leftover live-preview to a permanent block ONLY if the
        // canonical `thinking` SSE never arrived (model stream ended before
        // </think> closed, so the delta-side promotion above didn't fire).
        if (!thinkingReceived.has(ev.messageId)) {
          const remainingLive = useChatStore.getState().liveThinking;
          if (remainingLive && remainingLive.messageId === ev.messageId && remainingLive.text.trim()) {
            actions.addThinking(ev.messageId, remainingLive.text);
          }
        }
        thinkingReceived.delete(ev.messageId);
        messageBuffers.delete(ev.messageId);
        useChatStore.getState().finalizeLiveThinking();
        break;
      }

      case 'thinking': {
        if (!thinkingReceived.has(ev.messageId)) {
          thinkingReceived.add(ev.messageId);
          actions.addThinking(ev.messageId, ev.text);
        }
        break;
      }

      case 'activity_update':
        actions.setActivity({ phase: ev.phase, tool: ev.tool, detail: ev.detail });
        break;
      case 'tool_request':
        actions.addToolRequest(ev.callId, ev.tool, ev.args, ev.requiresApproval);
        break;
      case 'tool_result':
        actions.setToolResult(ev.callId, ev.ok, ev.output);
        break;
      case 'todo_update':
        actions.setTodos(ev.todos);
        break;
      case 'plan_update':
        actions.setPlanContent(ev.content);
        break;
      case 'mode_change':
        actions.setMode(ev.mode);
        break;
      case 'guardrail_triggered':
        actions.addToast(
          `${ev.action === 'block' ? 'Blocked' : 'Warning'}: ${ev.message}`,
          ev.action === 'block' ? 'error' : 'info',
        );
        break;
      case 'decision_request':
        actions.addDecision(ev.callId, ev.question, ev.options);
        break;
      case 'context_update':
        actions.setContextFiles(ev.files);
        break;
      case 'hypothesis_update':
        actions.updateHypothesisEntry(ev.id, ev.result, ev.actualOutcome);
        actions.addToast(
          `Hypothesis ${ev.result}: ${ev.actualOutcome?.slice(0, 60) ?? ''}`,
          ev.result === 'confirmed' ? 'success' : 'info',
        );
        break;
      case 'snapshot_created':
        actions.addToast(`Snapshot saved: ${ev.description}`, 'success');
        break;

      // ── Direct-to-store updates (page doesn't need an action method for these) ──
      case 'cost_update':
        useChatStore.getState().setCostUpdate(ev.turnTokens, ev.sessionTokens, ev.budget);
        break;
      case 'drift_warning':
        useChatStore.getState().setDriftWarning({ similarity: ev.similarity, action: ev.action });
        actions.addToast('Drift warning: action may not serve pinned intent', 'info');
        break;
      case 'regret_detected':
        useChatStore.getState().addRegret({ path: ev.path, editCount: ev.editCount, timespanMs: ev.timespanMs });
        break;
      case 'semantic_diff':
        useChatStore.getState().setSemanticDiff(ev.path, ev.summary, ev.added, ev.removed, ev.changed);
        break;
      case 'blast_radius':
        useChatStore.getState().setBlastRadius(ev.callId, {
          importers: ev.importers,
          references: ev.references,
          tests: ev.tests,
        });
        break;
      case 'proof_result':
        useChatStore.getState().setProofResult(ev.callId, ev.passed, ev.output);
        break;
      case 'mental_model_update':
        useChatStore.getState().setMentalModel(ev.nodes, ev.edges);
        break;
      case 'memory_recall':
        useChatStore.getState().setMemoryRecall(ev.matches);
        break;
      case 'test_results':
        useChatStore.getState().addTestResult(ev.callId, {
          runner: ev.runner,
          passed: ev.passed,
          failed: ev.failed,
          skipped: ev.skipped,
          duration: ev.duration,
          failures: ev.failures,
        });
        break;
      case 'workspace_change':
        actions.addWorkspaceChange({ files: ev.files, changeType: ev.changeType });
        break;

      // ── Phase 1 (sub-agent live telemetry) ────────────────────────────────
      case 'subagent_update': {
        const displayStatus = ev.status === 'done' ? 'completed' : ev.status;
        const isTerminal = ev.status !== 'running';
        useChatStore.getState().upsertSubAgent(ev.agentId, {
          description: ev.description,
          status: displayStatus,
          result: ev.result,
          ...(isTerminal ? { endedAt: Date.now() } : {}),
        });
        break;
      }
      case 'subagent_event': {
        const store = useChatStore.getState();
        if (ev.event === 'thinking' && ev.text) {
          store.appendSubAgentThinking(ev.agentId, ev.text);
        } else if (ev.event === 'tool_call' && ev.tool) {
          store.appendSubAgentToolCall(ev.agentId, ev.tool, ev.args);
        } else if (ev.event === 'tool_result') {
          store.setSubAgentToolResult(ev.agentId, ev.output ?? '', ev.ok ?? true);
        }
        // 'delta' is intentionally ignored — sub-agent prose surfaces via the
        // result field on subagent_update; live deltas would double-render.
        break;
      }

      case 'error': {
        // The user-initiated abort surfaces as `aborted` — that's not really an
        // error from the user's perspective so don't toast or banner it.
        if (ev.code !== 'aborted') {
          actions.setError(ev.message);
          actions.addToast(ev.message, 'error');
        }
        break;
      }

      case 'done': {
        actions.setActivity(null);
        actions.setStreaming(false);
        useChatStore.getState().finalizeLiveThinking();
        messageBuffers.clear();
        onDone?.();
        break;
      }
    }
  };

  return {
    onEvent: dispatch,
    onError: (e: Error) => {
      actions.setError(e.message);
      actions.setStreaming(false);
    },
    onClose: () => actions.setStreaming(false),
  };
}
