import fs from 'node:fs/promises';
import path from 'node:path';
import { ImageGenerateArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { resolveInside } from '../sandbox/fs.js';
import { config } from '../config.js';

export const imageGenerateTool: Tool<typeof ImageGenerateArgs._type> = {
  name: 'image_generate',
  description: 'Generate an image from a text prompt and save it to disk.',
  requiresApproval: false,
  schema: ImageGenerateArgs,
  async run(args, ctx) {
    const abs = resolveInside(ctx.workDir, args.outputPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });

    const width = args.width ?? 512;
    const height = args.height ?? 512;

    // --- Primary: koda model server ---
    let imageData: string | null = null;

    try {
      const ollamaRes = await fetch(`${config.OLLAMA_BASE_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.IMAGE_MODEL ?? 'koda-image',
          prompt: args.prompt,
          stream: false,
          options: { width, height },
        }),
        signal: ctx.signal,
      });

      if (ollamaRes.ok) {
        const body = await ollamaRes.json() as { images?: string[] };
        if (Array.isArray(body.images) && body.images.length > 0) {
          imageData = body.images[0] ?? null;
        }
      }
    } catch {
      // fallthrough to SD
    }

    // Don't attempt fallback if the caller already cancelled the request
    if (ctx.signal?.aborted) throw new Error('cancelled');

    // --- Fallback: Stable Diffusion API ---
    if (imageData === null) {
      const sdBase = process.env.SD_API_URL ?? 'http://localhost:7860';
      let sdRes: Response;
      try {
        sdRes = await fetch(`${sdBase}/sdapi/v1/txt2img`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: args.prompt, width, height, steps: 20 }),
          signal: ctx.signal,
        });
      } catch (err) {
        throw new Error(
          `Image generation failed. Neither the koda model server (${config.OLLAMA_BASE_URL}) ` +
          `nor the Stable Diffusion API (${sdBase}) responded. ` +
          `Ensure IMAGE_MODEL or SD_API_URL is configured and the server is running. ` +
          `Original error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (!sdRes.ok) {
        throw new Error(
          `Stable Diffusion API returned HTTP ${sdRes.status}. ` +
          `Check that the server at ${sdBase} is running and accessible.`,
        );
      }

      const sdBody = await sdRes.json() as { images?: string[] };
      if (!Array.isArray(sdBody.images) || sdBody.images.length === 0) {
        throw new Error(
          `Stable Diffusion API responded but returned no images. ` +
          `Verify the model is loaded and the request parameters are valid.`,
        );
      }
      imageData = sdBody.images[0]!;
    }

    // Decode base64 and write PNG
    const buffer = Buffer.from(imageData!, 'base64');
    await fs.writeFile(abs, buffer);

    return `Image saved to ${args.outputPath} (${width}×${height})`;
  },
};
