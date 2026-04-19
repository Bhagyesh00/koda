'use client';

import { useEffect, useRef, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { ChatThread } from '@/components/ChatThread';
import { Composer } from '@/components/Composer';
import { TodoPanel } from '@/components/TodoPanel';
import { PlanPanel } from '@/components/PlanPanel';
import { HeroHeader } from '@/components/HeroHeader';
import { ContextStrip } from '@/components/ContextStrip';
import { ToastContainer } from '@/components/ToastContainer';
import { GuardrailsPanel } from '@/components/GuardrailsPanel';
import { ContextLensPanel } from '@/components/ContextLensPanel';
import { HypothesisLog } from '@/components/HypothesisLog';
import { WorkspaceChangeBanner } from '@/components/WorkspaceChangeBanner';
import { CustomToolBuilder } from '@/components/CustomToolBuilder';
import { SnapshotTimeline } from '@/components/SnapshotTimeline';
import { IntentBanner } from '@/components/IntentBanner';
import { RegretPanel } from '@/components/RegretPanel';
import { CounterfactualModal } from '@/components/CounterfactualModal';
import { MentalModelCanvas } from '@/components/MentalModelCanvas';
import { PeerReviewModal } from '@/components/PeerReviewModal';
import { FolderPicker } from '@/components/FolderPicker';
import { MiniAgentPanel } from '@/components/MiniAgentPanel';
import { TokenDashboard } from '@/components/TokenDashboard';
import { useChatStore } from '@/lib/store';
import { startChatStream, startWatchStream } from '@/lib/sseClient';
import { getSession, listSessions, getPlan, createSession, updateSessionCwd } from '@/lib/api';
import { partitionThinking } from '@/lib/thinkingParser';
import type { DisplayMessage } from '@/lib/store';

export default function Page() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionCwd, setSessionCwd] = useState<string | undefined>(undefined);
  const [newChatModalOpen, setNewChatModalOpen] = useState(false);
  const [customToolsOpen, setCustomToolsOpen] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [regretOpen, setRegretOpen] = useState(false);
  const [replayTarget, setReplayTarget] = useState<{ callId: string; output: string } | null>(null);
  const [peerReviewOpen, setPeerReviewOpen] = useState(false);
  const [miniAgentOpen, setMiniAgentOpen] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [tokenDashboardOpen, setTokenDashboardOpen] = useState(false);
  // 'new' → create a fresh session; 'change-cwd' → update existing session's workdir
  const [folderPickerMode, setFolderPickerMode] = useState<'new' | 'change-cwd'>('new');
  const abortRef = useRef<AbortController | null>(null);
  const watchAbortRef = useRef<AbortController | null>(null);
  const bootstrapped = useRef(false);
  // Cumulative per-message buffer used for live <think> partitioning
  const messageBuffersRef = useRef<Map<string, string>>(new Map());
  // Track which messageIds already received a canonical `thinking` SSE so
  // we don't create a duplicate ThinkingBlock from the message_end handler.
  const thinkingReceivedRef = useRef<Set<string>>(new Set());

  const autoAccept = useChatStore((s) => s.autoAccept);

  const {
    streaming,
    mode,
    reset,
    appendUser,
    startAssistant,
    appendAssistantDelta,
    endAssistant,
    addToolRequest,
    setToolResult,
    setTodos,
    setStreaming,
    setError,
    setMode,
    setPlanContent,
    addThinking,
    setActivity,
    addToast,
    guardrailsOpen,
    setGuardrailsOpen,
    contextLensOpen,
    hypothesisLogOpen,
    mentalModelOpen,
    setMentalModelOpen,
    addDecision,
    resolveDecisionCard,
    setContextFiles,
    updateHypothesisEntry,
    addWorkspaceChange,
  } = useChatStore();

  function startNewChat() {
    setSessionId(null);
    setSessionCwd(undefined);
    setFolderPickerMode('new');
    setFolderPickerOpen(true);
  }

  // Ctrl+K / Cmd+K — start a new chat (clears session, opens folder picker)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        startNewChat();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // On first mount: pick the most recent existing session, if any.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void (async () => {
      try {
        const list = await listSessions();
        if (list.length > 0 && list[0]) {
          setSessionId(list[0].id);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [setError]);

  // Load session when changed
  useEffect(() => {
    if (!sessionId) {
      reset([]);
      setSessionCwd(undefined);
      return;
    }
    void (async () => {
      try {
        const session = await getSession(sessionId);
        setSessionCwd(session.cwd);
        const display: DisplayMessage[] = [];
        for (const m of session.messages) {
          if (m.role === 'user') {
            display.push({ kind: 'user', id: m.id, text: m.content });
          } else if (m.role === 'assistant') {
            // Restore ThinkingBlock BEFORE the assistant bubble so the layout
            // matches what was shown during the original streaming turn.
            if (m.thinking) {
              display.push({ kind: 'thinking', id: `${m.id}_thinking`, messageId: m.id, text: m.thinking });
            }
            display.push({
              kind: 'assistant',
              id: m.id,
              text: m.content,
              streaming: false,
              startedAt: m.createdAt,
            });
          }
        }
        reset(display);
        setTodos(session.todos);
        setMode(session.mode ?? 'build');
        // Sync session-level state into store
        useChatStore.getState().setPinnedIntentLocal(session.pinnedIntent ?? null);
        useChatStore.getState().setTokenBudgetLocal(session.tokenBudget);
        useChatStore.getState().setCostUpdate(0, session.tokensUsed ?? 0, session.tokenBudget);
        try {
          const plan = await getPlan(sessionId);
          setPlanContent(plan.content);
        } catch {
          setPlanContent(null);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [sessionId, reset, setTodos, setError, setMode, setPlanContent]);

  // Ambient Watch Mode: open a persistent SSE connection per session
  useEffect(() => {
    if (!sessionId) return;
    watchAbortRef.current?.abort();
    watchAbortRef.current = startWatchStream(sessionId, {
      onEvent: (ev) => {
        if (ev.type === 'workspace_change') {
          addWorkspaceChange({ files: ev.files, changeType: ev.changeType });
        }
      },
    });
    return () => {
      watchAbortRef.current?.abort();
    };
  }, [sessionId, addWorkspaceChange]);

  function handleSend(text: string, opts?: { showThinking?: boolean; modeOverride?: 'plan' | 'build' }) {
    if (!sessionId) return;
    // Strip metadata tags so only the user's actual message is visible in chat
    const displayText = text
      .replace(/<web_search[^/]*\/>\s*/g, '')
      .replace(/<file[\s\S]*?<\/file>\s*/g, '')
      .replace(/<folder[^/]*\/>\s*/g, '')
      .trim() || text;
    appendUser(displayText);
    setStreaming(true);
    setError(null);

    abortRef.current = startChatStream(
      { sessionId, message: text, mode: opts?.modeOverride ?? mode, autoApproveAll: autoAccept, showThinking: opts?.showThinking },
      {
        onEvent: (ev) => {
          switch (ev.type) {
            case 'message_start':
              startAssistant(ev.messageId);
              messageBuffersRef.current.set(ev.messageId, '');
              break;
            case 'delta': {
              appendAssistantDelta(ev.messageId, ev.text);
              const prev = messageBuffersRef.current.get(ev.messageId) ?? '';
              const next = prev + ev.text;
              messageBuffersRef.current.set(ev.messageId, next);
              const { liveThinking } = partitionThinking(next);
              if (liveThinking) {
                useChatStore.getState().setLiveThinking(ev.messageId, liveThinking);
              }
              // As soon as </think> closes, promote thinking to a permanent
              // ThinkingBlock inserted ABOVE the streaming assistant bubble.
              // This avoids the layout inversion where LiveThinkingPreview
              // sits below the response because it renders after all messages.
              if (
                !thinkingReceivedRef.current.has(ev.messageId) &&
                next.includes('</think>')
              ) {
                const m = next.match(/<think>([\s\S]*?)<\/think>/);
                if (m?.[1]?.trim()) {
                  thinkingReceivedRef.current.add(ev.messageId);
                  addThinking(ev.messageId, m[1].trim());
                  useChatStore.getState().finalizeLiveThinking();
                }
              }
              break;
            }
            case 'message_end': {
              endAssistant(ev.messageId);
              // Only promote liveThinking to a permanent block when the
              // canonical `thinking` SSE never arrived (model stream ended
              // before </think> closed, so extractThinkingBlocks found nothing).
              if (!thinkingReceivedRef.current.has(ev.messageId)) {
                const remainingLive = useChatStore.getState().liveThinking;
                if (
                  remainingLive &&
                  remainingLive.messageId === ev.messageId &&
                  remainingLive.text.trim()
                ) {
                  addThinking(ev.messageId, remainingLive.text);
                }
              }
              thinkingReceivedRef.current.delete(ev.messageId);
              messageBuffersRef.current.delete(ev.messageId);
              useChatStore.getState().finalizeLiveThinking();
              break;
            }
            case 'thinking':
              // Skip if already promoted from the delta stream when </think> closed.
              if (!thinkingReceivedRef.current.has(ev.messageId)) {
                thinkingReceivedRef.current.add(ev.messageId);
                addThinking(ev.messageId, ev.text);
              }
              break;
            case 'activity_update':
              setActivity({ phase: ev.phase, tool: ev.tool, detail: ev.detail });
              break;
            case 'tool_request':
              addToolRequest(ev.callId, ev.tool, ev.args, ev.requiresApproval);
              break;
            case 'tool_result':
              setToolResult(ev.callId, ev.ok, ev.output);
              break;
            case 'todo_update':
              setTodos(ev.todos);
              break;
            case 'plan_update':
              setPlanContent(ev.content);
              break;
            case 'mode_change':
              setMode(ev.mode);
              break;
            case 'guardrail_triggered':
              addToast(
                `${ev.action === 'block' ? 'Blocked' : 'Warning'}: ${ev.message}`,
                ev.action === 'block' ? 'error' : 'info',
              );
              break;
            case 'decision_request':
              addDecision(ev.callId, ev.question, ev.options);
              break;
            case 'context_update':
              setContextFiles(ev.files);
              break;
            case 'hypothesis_update':
              updateHypothesisEntry(ev.id, ev.result, ev.actualOutcome);
              addToast(
                `Hypothesis ${ev.result}: ${ev.actualOutcome?.slice(0, 60) ?? ''}`,
                ev.result === 'confirmed' ? 'success' : 'info',
              );
              break;
            case 'snapshot_created':
              addToast(`Snapshot saved: ${ev.description}`, 'success');
              break;
            case 'cost_update':
              useChatStore.getState().setCostUpdate(ev.turnTokens, ev.sessionTokens, ev.budget);
              break;
            case 'drift_warning':
              useChatStore.getState().setDriftWarning({ similarity: ev.similarity, action: ev.action });
              addToast(`Drift warning: action may not serve pinned intent`, 'info');
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
              addWorkspaceChange({ files: ev.files, changeType: ev.changeType });
              break;
            case 'error':
              if (ev.code !== 'aborted') {
                setError(ev.message);
                addToast(ev.message, 'error');
              }
              break;
            case 'done':
              setActivity(null);
              setStreaming(false);
              useChatStore.getState().finalizeLiveThinking();
              messageBuffersRef.current.clear();
              break;
          }
        },
        onError: (e) => {
          setError(e.message);
          setStreaming(false);
        },
        onClose: () => {
          setStreaming(false);
        },
      },
    );
  }

  function handleStop() {
    abortRef.current?.abort();
    setStreaming(false);
    // Also signal the server to abort the running turn
    if (sessionId) {
      fetch(`/api/sessions/${sessionId}/cancel`, { method: 'POST' }).catch(() => {});
    }
  }

  function handleDecisionResolve(callId: string, optionIndex: number) {
    resolveDecisionCard(callId, optionIndex);
  }

  function handleReplay(callId: string, output: string) {
    setReplayTarget({ callId, output });
  }

  async function handleFolderSelected(picked: string) {
    setFolderPickerOpen(false);
    try {
      if (folderPickerMode === 'change-cwd' && sessionId) {
        // Update working directory of the current session — don't create a new one.
        const normalised = await updateSessionCwd(sessionId, picked);
        setSessionCwd(normalised);
        addToast(`Working directory changed to ${normalised}`, 'success');
      } else {
        // Create a brand-new session rooted at the picked folder.
        const session = await createSession({ cwd: picked });
        setSessionId(session.id);
        setSessionCwd(session.cwd);
        addToast(`Session rooted at ${picked}`, 'success');
      }
    } catch (e) {
      addToast((e as Error).message, 'error');
    }
  }

  const todos = useChatStore((s) => s.todos);
  const planContent = useChatStore((s) => s.planContent);
  const showPlanPanel = mode === 'plan' && planContent !== null;

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <ToastContainer />
      <Sidebar
        activeId={sessionId}
        onSelect={setSessionId}
        modalOpen={newChatModalOpen}
        onModalOpenChange={setNewChatModalOpen}
        onNewChat={startNewChat}
      />
      {customToolsOpen && <CustomToolBuilder onClose={() => setCustomToolsOpen(false)} />}
      {peerReviewOpen && sessionId && (
        <PeerReviewModal sessionId={sessionId} onClose={() => setPeerReviewOpen(false)} />
      )}
      {replayTarget && sessionId && (
        <CounterfactualModal
          sessionId={sessionId}
          callId={replayTarget.callId}
          originalContent={replayTarget.output}
          onClose={() => setReplayTarget(null)}
          onReplayCreated={(id) => { setSessionId(id); setReplayTarget(null); }}
        />
      )}
      {folderPickerOpen && (
        <FolderPicker
          initialPath={sessionCwd}
          onSelect={(p) => void handleFolderSelected(p)}
          onClose={() => setFolderPickerOpen(false)}
        />
      )}
      <main className="flex flex-1 flex-col overflow-hidden">
        <HeroHeader
          sessionId={sessionId}
          onToggleGuardrails={() => setGuardrailsOpen(!guardrailsOpen)}
          onOpenCustomTools={() => setCustomToolsOpen(true)}
          onToggleSnapshots={() => setSnapshotsOpen(!snapshotsOpen)}
          onToggleRegret={() => setRegretOpen(!regretOpen)}
          onOpenPeerReview={() => setPeerReviewOpen(true)}
          onOpenMiniAgent={() => setMiniAgentOpen((v) => !v)}
          miniAgentOpen={miniAgentOpen}
          onOpenTokenDashboard={() => setTokenDashboardOpen(true)}
        />
        {tokenDashboardOpen && <TokenDashboard onClose={() => setTokenDashboardOpen(false)} />}
        <IntentBanner sessionId={sessionId} />
        <WorkspaceChangeBanner />
        <TodoPanel todos={todos} />
        <div className="flex flex-1 overflow-hidden">
          <ChatThread onDecisionResolve={handleDecisionResolve} onReplay={handleReplay} />
          {showPlanPanel && sessionId && (
            <PlanPanel
              sessionId={sessionId}
              content={planContent}
              onApproved={() => handleSend('Execute the approved plan step by step.', { modeOverride: 'build' })}
            />
          )}
          {guardrailsOpen && sessionId && (
            <GuardrailsPanel sessionId={sessionId} onClose={() => setGuardrailsOpen(false)} />
          )}
          {contextLensOpen && (
            <ContextLensPanel onClose={() => useChatStore.getState().setContextLensOpen(false)} />
          )}
          {hypothesisLogOpen && (
            <HypothesisLog onClose={() => useChatStore.getState().setHypothesisLogOpen(false)} />
          )}
          {snapshotsOpen && sessionId && (
            <SnapshotTimeline sessionId={sessionId} onClose={() => setSnapshotsOpen(false)} />
          )}
          {regretOpen && <RegretPanel onClose={() => setRegretOpen(false)} />}
          {mentalModelOpen && <MentalModelCanvas onClose={() => setMentalModelOpen(false)} />}
          {miniAgentOpen && sessionId && (
            <MiniAgentPanel sessionId={sessionId} onClose={() => setMiniAgentOpen(false)} />
          )}
        </div>
        <ContextStrip />
        <Composer
          sessionId={sessionId}
          onSend={handleSend}
          onStop={handleStop}
          streaming={streaming}
          disabled={!sessionId}
          cwd={sessionCwd}
          onSelectFolder={() => {
            setFolderPickerMode(sessionId ? 'change-cwd' : 'new');
            setFolderPickerOpen(true);
          }}
          onCommandFeedback={(msg, ok) => addToast(msg, ok ? 'success' : 'error')}
        />
      </main>
    </div>
  );
}
