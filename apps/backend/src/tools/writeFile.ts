import fs from 'node:fs/promises';
import path from 'node:path';
import { WriteFileArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { resolveInside } from '../sandbox/fs.js';
import { runSecurityScan } from '../agent/stages/securityScan.js';

export const writeFileTool: Tool<typeof WriteFileArgs._type> = {
  name: 'write_file',
  description: 'Create or overwrite a file. Requires user approval.',
  requiresApproval: true,
  schema: WriteFileArgs,
  async run(args, ctx) {
    const abs = resolveInside(ctx.workDir, args.path);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, args.content, 'utf8');
    const warning = runSecurityScan(args.path, args.content);
    const base = `Wrote ${args.content.length} bytes to ${args.path}`;
    return warning ? `${base}\n\n${warning}` : base;
  },
};
