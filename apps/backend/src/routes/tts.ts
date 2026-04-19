import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { logger } from '../logger.js';

export const ttsRouter: Router = Router();

const TtsBody = z.object({
  text: z.string().min(1).max(4096),
  voice: z.string().optional(),
  model: z.string().optional(),
});

ttsRouter.post('/tts', async (req, res) => {
  if (!config.TTS_BASE_URL) {
    res.status(503).json({ error: 'TTS_BASE_URL is not configured' });
    return;
  }

  const { text, voice, model } = TtsBody.parse(req.body ?? {});
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.TTS_API_KEY) headers['Authorization'] = `Bearer ${config.TTS_API_KEY}`;

  logger.info({ model: model ?? config.TTS_MODEL, voice: voice ?? config.TTS_VOICE, chars: text.length }, 'tts request');

  const upstream = await fetch(`${config.TTS_BASE_URL}/audio/speech`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: model ?? config.TTS_MODEL,
      input: text,
      voice: voice ?? config.TTS_VOICE,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!upstream.ok) {
    const msg = await upstream.text().catch(() => '');
    res.status(upstream.status).json({ error: `TTS upstream error: ${msg.slice(0, 200)}` });
    return;
  }

  res.setHeader('Content-Type', upstream.headers.get('Content-Type') ?? 'audio/mpeg');
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.send(buf);
});
