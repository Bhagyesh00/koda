'use client';

import { useEffect, useRef } from 'react';
import { useChatStore } from '@/lib/store';
import { stripThinkingBlocks } from '@/lib/thinkingParser';
import { MessageBubble } from './MessageBubble';
import { ToolCallCard } from './ToolCallCard';
import { ThinkingBlock } from './ThinkingBlock';
import { DecisionCard } from './DecisionCard';
import { MemoryRecallCard } from './MemoryRecallCard';
import { LiveThinkingPreview } from './LiveThinkingPreview';
import { InlineActivityHint } from './ActivityStatus';
import { Logo } from './Logo';

interface Props {
  onDecisionResolve: (callId: string, optionIndex: number) => void;
  onReplay?: (callId: string, originalOutput: string) => void;
}

export function ChatThread({ onDecisionResolve, onReplay }: Props) {
  const messages = useChatStore((s) => s.messages);
  const error = useChatStore((s) => s.error);
  const mode = useChatStore((s) => s.mode);
  const liveThinking = useChatStore((s) => s.liveThinking);
  const ref = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages AND when live thinking starts streaming
  // (liveThinking is a separate field, not part of messages, so needs its own dep).
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [messages, liveThinking]);

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
              Your private coding companion. I read your code, propose changes, run commands, and
              keep everything on your machine.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[11px] text-fg-subtle">
              <Hint>Ask me to read a file</Hint>
              <Hint>Plan a refactor</Hint>
              <Hint>Run the tests</Hint>
            </div>
            <p className="mt-6 text-[11px] text-fg-subtle">
              Currently in <span className="text-accent">{mode === 'plan' ? 'Plan' : 'Build'}</span>{' '}
              mode — switch from the composer below.
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
            // Always strip <think> blocks — react-markdown silently removes
            // unknown HTML tags, which leaves an empty bubble if the model
            // emitted only thinking content. Thinking is rendered separately
            // by the dedicated ThinkingBlock entry.
            const displayText = stripThinkingBlocks(m.text);
            // Hide empty bubbles at all times — during streaming the
            // InlineActivityHint covers the "agent is working" signal, so
            // there is no need to flash an empty bubble. This also prevents
            // the flicker where a bubble appears then vanishes when the model
            // uses native tool calling and emits no prose text.
            if (displayText.trim() === '') return null;
            return (
              <MessageBubble
                key={m.id}
                role="assistant"
                text={displayText}
                streaming={m.streaming}
                startedAt={m.startedAt}
              />
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
        <LiveThinkingPreview />
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
