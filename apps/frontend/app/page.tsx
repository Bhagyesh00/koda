'use client';

import { useEffect, useRef, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { ChatThread } from '@/components/ChatThread';
import { Composer } from '@/components/Composer';
import { TodoPanel } from '@/components/TodoPanel';
import { PlanPanel } from '@/components/PlanPanel';
import { HeroHeader } from '@/components/HeroHeader';
import { useChatStore } from '@/lib/store';
import { startChatStream } from '@/lib/sseClient';
import { getSession, listSessions, getPlan } from '@/lib/api';
import type { DisplayMessage } from '@/lib/store';

export default function Page() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bootstrapped = useRef(false);

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
  } = useChatStore();

  // On first mount: pick the most recent existing session, if any.
  // We deliberately do NOT auto-create here — that caused orphan chats
  // (StrictMode double-invoke + race with the user clicking "New chat").
  // The Sidebar's "New chat" flow is the only path that creates sessions.
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

  // Load session when changed (messages, todos, mode, current plan)
  useEffect(() => {
    if (!sessionId) {
      reset([]);
      return;
    }
    void (async () => {
      try {
        const session = await getSession(sessionId);
        const display: DisplayMessage[] = [];
        for (const m of session.messages) {
          if (m.role === 'user') {
            display.push({ kind: 'user', id: m.id, text: m.content });
          } else if (m.role === 'assistant') {
            display.push({ kind: 'assistant', id: m.id, text: m.content, streaming: false });
          }
          // tool messages are not replayed visually on reload (kept simple for MVP)
        }
        reset(display);
        setTodos(session.todos);
        setMode(session.mode ?? 'build');
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

  function handleSend(text: string) {
    if (!sessionId) return;
    appendUser(text);
    setStreaming(true);
    setError(null);

    abortRef.current = startChatStream(
      { sessionId, message: text, mode },
      {
        onEvent: (ev) => {
          switch (ev.type) {
            case 'message_start':
              startAssistant(ev.messageId);
              break;
            case 'delta':
              appendAssistantDelta(ev.messageId, ev.text);
              break;
            case 'message_end':
              endAssistant(ev.messageId);
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
            case 'error':
              setError(ev.message);
              break;
            case 'done':
              setStreaming(false);
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
  }

  const todos = useChatStore((s) => s.todos);
  const planContent = useChatStore((s) => s.planContent);
  const showPlanPanel = mode === 'plan' && planContent !== null;

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar activeId={sessionId} onSelect={setSessionId} />
      <main className="flex flex-1 flex-col overflow-hidden">
        <HeroHeader sessionId={sessionId} />
        <TodoPanel todos={todos} />
        <div className="flex flex-1 overflow-hidden">
          <ChatThread />
          {showPlanPanel && sessionId && (
            <PlanPanel sessionId={sessionId} content={planContent} />
          )}
        </div>
        <Composer
          onSend={handleSend}
          onStop={handleStop}
          streaming={streaming}
          disabled={!sessionId}
        />
      </main>
    </div>
  );
}
