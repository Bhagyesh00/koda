import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Tool } from './registry.js';
import { TtsSpeakArgs } from '@koda/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';

export const ttsSpeakTool: Tool<TtsSpeakArgs> = {
  name: 'tts_speak',
  description: 'Convert text to speech and save as an mp3 file. Requires TTS_BASE_URL to be configured.',
  requiresApproval: false,
  schema: TtsSpeakArgs,

  async run(args) {
    if (!config.TTS_BASE_URL) {
      return 'Error: TTS_BASE_URL is not configured. Set it in your .env to an OpenAI-compatible TTS endpoint.';
    }

    const outPath = args.outPath
      ? path.resolve(config.WORK_DIR_ABS, args.outPath)
      : path.join(config.WORK_DIR_ABS, '.koda', 'tts', `${Date.now()}.mp3`);

    await fs.mkdir(path.dirname(outPath), { recursive: true });

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.TTS_API_KEY) headers['Authorization'] = `Bearer ${config.TTS_API_KEY}`;

    logger.info({ outPath, chars: args.text.length }, 'tts_speak');

    const res = await fetch(`${config.TTS_BASE_URL}/audio/speech`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.TTS_MODEL,
        input: args.text,
        voice: args.voice ?? config.TTS_VOICE,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      return `Error: TTS upstream returned HTTP ${res.status}: ${msg.slice(0, 200)}`;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(outPath, buf);

    return `Audio saved to: ${outPath} (${(buf.length / 1024).toFixed(1)} KB)`;
  },
};
