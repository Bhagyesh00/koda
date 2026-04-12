import fs from 'node:fs/promises';
import path from 'node:path';
import { WriteFileArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { resolveInside } from '../sandbox/fs.js';

export const writeFileTool: Tool<typeof WriteFileArgs._type> = {
  name: 'write_file',
  description: 'Create or overwrite a file. Requires user approval.',
  requiresApproval: true,
  schema: WriteFileArgs,
  async run(args, ctx) {
    const abs = resolveInside(ctx.workDir, args.path);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, args.content, 'utf8');
    return `Wrote ${args.content.length} bytes to ${args.path}`;
  },
};
