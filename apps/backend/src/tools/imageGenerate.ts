import fs from 'node:fs/promises';
import path from 'node:path';
import { ImageGenerateArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { resolveInside } from '../sandbox/fs.js';
import { config } from '../config.js';

export const imageGenerateTool: Tool<typeof ImageGenerateArgs._type> = {
  name: 'image_generate',
  description: 'Generate an image from a text prompt using local Stable Diffusion (AUTOMATIC1111) and save it to disk.',
  requiresApproval: false,
  schema: ImageGenerateArgs,
  async run(args, ctx) {
    const abs = resolveInside(ctx.workDir, args.outputPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });

    const width = args.width ?? config.SD_WIDTH;
    const height = args.height ?? config.SD_HEIGHT;
    const endpoint = `${config.SD_BASE_URL}/sdapi/v1/txt2img`;

    const payload: Record<string, unknown> = {
      prompt: args.prompt,
      negative_prompt: config.SD_NEGATIVE_PROMPT,
      width,
      height,
      steps: config.SD_STEPS,
      cfg_scale: config.SD_CFG_SCALE,
      sampler_name: config.SD_SAMPLER,
    };
    if (config.SD_MODEL) payload['override_settings'] = { sd_model_checkpoint: config.SD_MODEL };

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctx.signal,
      });
    } catch (err) {
      throw new Error(
        `Image generation failed — could not reach AUTOMATIC1111 at ${config.SD_BASE_URL}. ` +
        `Start it with: python launch.py --api\n` +
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `AUTOMATIC1111 returned HTTP ${res.status}. ` +
        `Make sure it was started with the --api flag.\n${text}`,
      );
    }

    const body = await res.json() as { images?: string[] };
    if (!Array.isArray(body.images) || body.images.length === 0) {
      throw new Error('AUTOMATIC1111 responded but returned no images.');
    }

    const buffer = Buffer.from(body.images[0]!, 'base64');
    await fs.writeFile(abs, buffer);

    return `Image saved to ${args.outputPath} (${width}×${height})`;
  },
};
