import { promises as fs } from 'node:fs';
import type { Tool } from './registry.js';
import { Scene3dArgs } from '@koda/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { ollamaHeaders } from '../agent/ollama.js';

const QUICK_PROMPT = `Analyze the 3D spatial structure of this image. Respond with JSON only:
{
  "depthLayers": ["foreground objects", "midground objects", "background objects"],
  "dominantPlanes": ["horizontal ground", "vertical wall", ...],
  "summary": "one sentence spatial description"
}`;

const DETAILED_PROMPT = `You are a 3D spatial analysis expert. Analyze this image and respond with JSON only (no markdown):
{
  "depthLayers": {
    "foreground": ["list of objects/elements closest to viewer"],
    "midground": ["list of objects/elements at mid distance"],
    "background": ["list of objects/elements furthest away"]
  },
  "spatialRelationships": [
    { "subject": "object A", "relation": "in front of / behind / left of / above", "object": "object B" }
  ],
  "vanishingPoints": ["describe each vanishing point and its location in the frame"],
  "dominantPlanes": ["horizontal ground plane", "vertical wall", "other planes detected"],
  "occlusionRelationships": [
    { "occluded": "hidden object", "occludedBy": "object blocking it" }
  ],
  "estimatedDepthRange": "e.g. 0–50 meters / 0–5 meters (indoor)",
  "sceneType": "indoor / outdoor / abstract / other",
  "summary": "two to three sentence spatial description of the scene"
}`;

export const scene3dTool: Tool<Scene3dArgs> = {
  name: 'scene_3d',
  description: 'Analyze the 3D spatial structure of an image: depth layers, spatial relationships, vanishing points, occlusion.',
  requiresApproval: false,
  schema: Scene3dArgs,

  async run(args, ctx) {
    const model = config.OLLAMA_MODEL;
    let imageBase64: string;

    if (args.imagePath) {
      const absPath = args.imagePath.startsWith('/')
        ? args.imagePath
        : `${ctx.workDir}/${args.imagePath}`;
      try {
        const buf = await fs.readFile(absPath);
        imageBase64 = buf.toString('base64');
      } catch (err) {
        return `Error reading image: ${err instanceof Error ? err.message : String(err)}`;
      }
    } else if (args.imageUrl) {
      try {
        const res = await fetch(args.imageUrl, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) return `Error fetching image: HTTP ${res.status}`;
        const buf = await res.arrayBuffer();
        imageBase64 = Buffer.from(buf).toString('base64');
      } catch (err) {
        return `Error fetching image: ${err instanceof Error ? err.message : String(err)}`;
      }
    } else {
      return 'Error: either imagePath or imageUrl is required';
    }

    const prompt = args.detail === 'quick' ? QUICK_PROMPT : DETAILED_PROMPT;
    logger.info({ model, detail: args.detail }, 'scene_3d analysis');

    const res = await fetch(`${config.OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: ollamaHeaders(),
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: 'user', content: prompt, images: [imageBase64] }],
        options: { temperature: 0 },
      }),
      signal: ctx.signal ?? AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return `Error: vision model returned HTTP ${res.status}: ${text.slice(0, 200)}`;
    }

    const data = (await res.json()) as { message?: { content?: string } };
    const raw = (data.message?.content ?? '').trim();

    // Try to parse and pretty-print the JSON
    try {
      const parsed = JSON.parse(raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, ''));
      return JSON.stringify(parsed, null, 2);
    } catch {
      return raw || 'Error: vision model returned an empty response';
    }
  },
};
