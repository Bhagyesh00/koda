'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef } from 'react';
import { useChatStore, type SubAgentDisplay } from '@/lib/store';
import { stripThinkingBlocks } from '@/lib/thinkingParser';
import { MessageBubble } from './MessageBubble';
import { ToolCallCard } from './ToolCallCard';
import { ThinkingBlock } from './ThinkingBlock';
import { DecisionCard } from './DecisionCard';
import { MemoryRecallCard } from './MemoryRecallCard';
import { LiveThinkingPreview } from './LiveThinkingPreview';
import { InlineActivityHint } from './ActivityStatus';
import { Logo } from './Logo';
import { TtsPlayer } from './TtsPlayer';
import { SubAgentPanel } from './SubAgentPanel';

interface Props {
  onDecisionResolve: (callId: string, optionIndex: number) => void;
  onReplay?: (callId: string, originalOutput: string) => void;
}

export function ChatThread({ onDecisionResolve, onReplay }: Props) {
  const messages = useChatStore((s) => s.messages);
  const error = useChatStore((s) => s.error);
  const subAgents = useChatStore((s) => s.subAgents);
  const subAgentOrder = useChatStore((s) => s.subAgentOrder);
  const ref = useRef<HTMLDivElement>(null);
  // Pinned-to-bottom state. We default to true so the first paint scrolls down,
  // and flip it off when the user manually scrolls up — so streaming text
  // doesn't yank them back to the bottom while they're reading earlier content.
  const stickToBottomRef = useRef(true);
  // rAF coalescing flag. Without this, a 100-token assistant response queues
  // 100 scrollTo() calls in the same frame; with smooth scrolling each one
  // restarts the animation from a fresh position — the visible "up-down-up-down"
  // bounce. One scroll per frame is plenty.
  const scrollPendingRef = useRef(false);

  // Project the keyed map back into an ordered array, attaching the derived
  // `index` the panel needs for stable color/animation slots.
  const subAgentArr = useMemo<SubAgentDisplay[]>(
    () =>
      subAgentOrder
        .map((id, i) => {
          const a = subAgents[id];
          return a ? { ...a, index: i } : null;
        })
        .filter((a): a is SubAgentDisplay => a !== null),
    [subAgents, subAgentOrder],
  );
  const allSubAgentsDone =
    subAgentArr.length > 0 && subAgentArr.every((a) => a.status !== 'running');

  // Re-engage stick-to-bottom when the user scrolls within ~80 px of the floor;
  // disengage as soon as they scroll away. The ref-only update avoids a re-render
  // per scroll tick (which would itself worsen the flicker we just fixed).
  const handleScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    if (scrollPendingRef.current) return;
    scrollPendingRef.current = true;
    requestAnimationFrame(() => {
      scrollPendingRef.current = false;
      const el = ref.current;
      if (!el) return;
      // Direct scrollTop assignment, NOT smooth — smooth animations stack
      // every delta and create the visible scroll-bounce. The eye doesn't
      // notice instant jumps when the new content is the same prose growing
      // line-by-line, but it does notice repeated 300 ms animations interrupting.
      el.scrollTop = el.scrollHeight;
    });
  }, [messages, subAgentArr.length]);

  return (
    <div ref={ref} className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl py-4">
        <MemoryRecallCard />
        {messages.length === 0 && (
          <div className="flex flex-col items-center px-6 py-24 text-center">
            <Logo size={72} animated className="mb-5 drop-shadow-[0_0_24px_rgba(217,119,87,0.35)]" />
            <h2 className="mb-2 bg-gradient-to-br from-fg via-fg to-accent-2 bg-clip-text text-3xl font-semibold tracking-tight text-transparent">
              Hey, I'm Koda.
            </h2>
            <p className="max-w-md text-[14px] leading-relaxed text-fg-muted">
              Your private AI coding agent. I read your code, write changes, run commands,
              and keep everything on your machine.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <Hint>Read a file</Hint>
              <Hint>Fix a bug</Hint>
              <Hint>Plan a refactor</Hint>
              <Hint>Run tests</Hint>
              <Hint>Search the web</Hint>
            </div>
            <p className="mt-5 text-[11px] text-fg-subtle/60">
              Type <span className="font-mono text-fg-subtle">@</span> to attach files
              {' · '}
              <span className="font-mono text-fg-subtle">/</span> for commands
            </p>
          </div>
        )}
        {messages.map((m) => {
          if (m.kind === 'user') return <MessageBubble key={m.id} role="user" text={m.text} />;
          if (m.kind === 'thinking') return <ThinkingBlock key={m.id} text={m.text} />;
          if (m.kind === 'decision') {
            return (
              <DecisionCard
                key={m.id}
                callId={m.callId}
                question={m.question}
                options={m.options}
                resolved={m.resolved}
                chosenIndex={m.chosenIndex}
                onResolve={onDecisionResolve}
              />
            );
          }
          if (m.kind === 'assistant') {
            const displayText = stripThinkingBlocks(m.text);
            // During streaming, show LiveThinkingPreview above the bubble so
            // thinking always appears before the response — never below it.
            return (
              <Fragment key={m.id}>
                {m.streaming && <LiveThinkingPreview messageId={m.id} />}
                {displayText.trim() !== '' && (
                  <>
                    <MessageBubble
                      role="assistant"
                      text={displayText}
                      streaming={m.streaming}
                      startedAt={m.startedAt}
                      endedAt={m.endedAt}
                    />
                    {!m.streaming && displayText.trim().length > 0 && (
                      <div className="ml-10 mt-0.5">
                        <TtsPlayer text={displayText} />
                      </div>
                    )}
                  </>
                )}
              </Fragment>
            );
          }
          return (
            <ToolCallCard
              key={m.id}
              callId={m.callId}
              tool={m.tool}
              args={m.args}
              requiresApproval={m.requiresApproval}
              status={m.status}
              output={m.output}
              onReplay={onReplay}
            />
          );
        })}
        {subAgentArr.length > 0 && (
          <div className="my-3">
            <SubAgentPanel agents={subAgentArr} allDone={allSubAgentsDone} />
          </div>
        )}
        <InlineActivityHint />
        {error && (
          <div className="mx-6 my-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-300">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-bg-panel/60 px-3 py-1 backdrop-blur">
      {children}
    </span>
  );
}
