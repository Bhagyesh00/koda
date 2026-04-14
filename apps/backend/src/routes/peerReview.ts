import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { sessionStore } from '../sessions/store.js';
import { NotFoundError } from '../errors.js';
import { streamOllamaChat, type OllamaMessage } from '../agent/ollama.js';
import { buildSystemPrompt, buildPlanModePrompt } from '../agent/prompts.js';
import { config } from '../config.js';
import { stripThinkingBlocks } from '../agent/parser.js';

export const peerReviewRouter: RouterType = Router();

/**
 * POST /sessions/:id/peer-review
 * Replays the LAST user message against the session history with two
 * different temperatures, returning both responses for side-by-side diff.
 */
peerReviewRouter.post('/sessions/:id/peer-review', async (req, res) => {
  const session = sessionStore.get(req.params.id ?? '');
  if (!session) throw new NotFoundError('session');

  // Need at least one user message
  const lastUserIdx = [...session.messages].reverse().findIndex((m) => m.role === 'user');
  if (lastUserIdx < 0) {
    res.status(400).json({ error: 'no user message to review' });
    return;
  }

  const workDir = session.cwd ?? config.WORK_DIR_ABS;
  const systemPrompt = session.mode === 'plan'
    ? buildPlanModePrompt(workDir)
    : buildSystemPrompt(workDir);

  // Build message history up to (and including) the last user message
  const trimmedMessages = session.messages.slice(
    0,
    session.messages.length - lastUserIdx,
  );

  const baseMessages: OllamaMessage[] = [
    { role: 'system', content: systemPrompt },
    ...trimmedMessages.map((m) => ({
      role: m.role === 'tool' ? ('user' as const) : (m.role as 'user' | 'assistant'),
      content: m.role === 'tool' ? `Tool result (${m.toolCallId ?? ''}):\n${m.content}` : m.content,
    })),
  ];

  // Capture model before entering closures (TypeScript narrowing doesn't flow into nested fns).
  const sessionModel = session.model;

  // Collect two responses in parallel: low temp (conservative) + high temp (creative)
  async function collect(temp: number, seed: number): Promise<string> {
    let text = '';
    await streamOllamaChat(
      baseMessages,
      (delta) => { text += delta; },
      undefined,
      { temperature: temp, seed, model: sessionModel },
    );
    return stripThinkingBlocks(text).trim();
  }

  try {
    const [responseA, responseB] = await Promise.all([
      collect(0.2, 1),
      collect(0.8, 2),
    ]);
    res.json({
      optionA: { label: 'Conservative (temp 0.2)', content: responseA },
      optionB: { label: 'Creative (temp 0.8)', content: responseB },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
