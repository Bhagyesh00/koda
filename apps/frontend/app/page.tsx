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
import { createChatStreamHandler } from '@/lib/sseHandlers';
import { getSession, listSessions, getPlan, createSession, updateSessionCwd } from '@/lib/api';
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
    // Clear last turn's sub-agent panel so a fresh user message starts a clean
    // canvas. Done HERE rather than on 'done' so completed agents remain
    // visible while the user reads the response.
    useChatStore.getState().clearSubAgents();
    appendUser(displayText);
    setStreaming(true);
    setError(null);

    abortRef.current = startChatStream(
      { sessionId, message: text, mode: opts?.modeOverride ?? mode, autoApproveAll: autoAccept, showThinking: opts?.showThinking },
      createChatStreamHandler({
        actions: {
          startAssistant,
          appendAssistantDelta,
          endAssistant,
          addThinking,
          setActivity,
          addToolRequest,
          setToolResult,
          setTodos,
          setPlanContent,
          setMode,
          addToast,
          addDecision,
          setContextFiles,
          updateHypothesisEntry,
          setError,
          setStreaming,
          addWorkspaceChange,
        },
      }),
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
