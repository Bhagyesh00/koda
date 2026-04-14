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
    const model = process.env.IMAGE_MODEL ?? 'koda-image';

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.OLLAMA_USERNAME && config.OLLAMA_PASSWORD) {
      headers['Authorization'] = `Basic ${Buffer.from(`${config.OLLAMA_USERNAME}:${config.OLLAMA_PASSWORD}`).toString('base64')}`;
    }

    let res: Response;
    try {
      res = await fetch(`${config.OLLAMA_BASE_URL}/api/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          prompt: args.prompt,
          stream: false,
          options: { width, height },
        }),
        signal: ctx.signal,
      });
    } catch (err) {
      throw new Error(
        `Image generation failed — could not reach the model server at ${config.OLLAMA_BASE_URL}. ` +
        `Ensure the server is running and IMAGE_MODEL (${model}) is available. ` +
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!res.ok) {
      throw new Error(
        `Image generation failed — model server returned HTTP ${res.status}. ` +
        `Check that model "${model}" is pulled and supports image generation.`,
      );
    }

    const body = await res.json() as { images?: string[] };
    if (!Array.isArray(body.images) || body.images.length === 0) {
      throw new Error(
        `Model "${model}" responded but returned no images. ` +
        `This model may not support image generation.`,
      );
    }

    const buffer = Buffer.from(body.images[0]!, 'base64');
    await fs.writeFile(abs, buffer);

    return `Image saved to ${args.outputPath} (${width}×${height})`;
  },
};
