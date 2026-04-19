import { promises as fs } from 'node:fs';
import { config } from '../../config.js';
import { logger } from '../../logger.js';
import { ollamaHeaders } from '../../agent/ollama.js';

export interface ScenarioGenerationResult {
  scenario: string;
  visionModel: string;
  frameCount: number;
}

/**
 * Given a sequence of screenshot frames and the starting URL, asks a
 * multimodal Ollama model to describe the user actions as a natural
 * language test scenario that can be fed into the selenium_test planner.
 */
export async function generateScenarioFromFrames(
  frames: string[],
  visionModel: string,
  url: string,
): Promise<ScenarioGenerationResult> {
  if (frames.length === 0) throw new Error('no frames provided');

  const images = await Promise.all(
    frames.map(async (p) => (await fs.readFile(p)).toString('base64')),
  );

  const sys =
    `You are a QA test generator. You are shown ${frames.length} sequential screenshots ` +
    `of a user completing a task in a web browser. The starting URL is "${url}".\n\n` +
    `Output a concise natural language test scenario describing EXACTLY what the user did, ` +
    `in order. Use precise action verbs (click, type, select, navigate, check, scroll, hover). ` +
    `When a UI element is visible, reference it by its visible label, placeholder, or role ` +
    `(e.g. "Click the Login button", "Type into the Username field"). End with at least one ` +
    `verification step describing what should be true after the actions (e.g. "assert the URL ` +
    `contains /dashboard", "assert the page body contains 'Welcome, ...'"). ` +
    `Do not invent steps; only describe what the frames show. Output plain prose, no lists, no markdown.`;

  const userContent = `Here are the frames in order. Generate the test scenario now.`;

  const body = {
    model: visionModel,
    stream: false,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: userContent, images },
    ],
    options: { temperature: 0 },
  };

  logger.info({ model: visionModel, frames: frames.length, url }, 'calling vision model');

  const res = await fetch(`${config.OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: ollamaHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Vision model returned HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { message?: { content?: string } };
  const scenario = (data.message?.content ?? '').trim();
  if (!scenario) throw new Error('Vision model returned an empty scenario');

  return { scenario, visionModel, frameCount: frames.length };
}
