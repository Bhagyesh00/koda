import fs from 'node:fs/promises';
import { ReadFileArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { resolveInside } from '../sandbox/fs.js';

const MAX_BYTES = 1_000_000;

export const readFileTool: Tool<typeof ReadFileArgs._type> = {
  name: 'read_file',
  description: 'Read the contents of a file inside the working directory.',
  requiresApproval: false,
  schema: ReadFileArgs,
  async run(args, ctx) {
    const abs = resolveInside(ctx.workDir, args.path);
    const stat = await fs.stat(abs);
    if (stat.size > MAX_BYTES) {
      return `Error: file too large (${stat.size} bytes, max ${MAX_BYTES})`;
    }
    const content = await fs.readFile(abs, 'utf8');
    if (args.offset == null && args.limit == null) return content;
    const lines = content.split('\n');
    const start = args.offset ?? 0;
    const end = args.limit != null ? start + args.limit : lines.length;
    return lines.slice(start, end).join('\n');
  },
};
