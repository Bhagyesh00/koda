import fs from 'node:fs/promises';
import { ListDirArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { resolveInside } from '../sandbox/fs.js';

export const listDirTool: Tool<typeof ListDirArgs._type> = {
  name: 'list_dir',
  description: 'List entries of a directory inside the working directory.',
  requiresApproval: false,
  schema: ListDirArgs,
  async run(args, ctx) {
    const abs = resolveInside(ctx.workDir, args.path ?? '.');
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const lines = entries
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort();
    return lines.length ? lines.join('\n') : '(empty)';
  },
};
