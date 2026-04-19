import fs from 'node:fs/promises';
import { EditFileArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { resolveInside } from '../sandbox/fs.js';
import { runSecurityScan } from '../agent/stages/securityScan.js';

export const editFileTool: Tool<EditFileArgs> = {
  name: 'edit_file',
  description: 'Replace an exact string in a file. Requires user approval.',
  requiresApproval: true,
  schema: EditFileArgs,
  async run(args, ctx) {
    const abs = resolveInside(ctx.workDir, args.path);
    const original = await fs.readFile(abs, 'utf8');
    if (!original.includes(args.oldString)) {
      return `Error: oldString not found in ${args.path}`;
    }
    if (!args.replaceAll) {
      const first = original.indexOf(args.oldString);
      const second = original.indexOf(args.oldString, first + 1);
      if (second !== -1) {
        return `Error: oldString matches multiple times in ${args.path}; pass replaceAll=true or provide more context`;
      }
    }
    const updated = args.replaceAll
      ? original.split(args.oldString).join(args.newString)
      : original.replace(args.oldString, args.newString);
    await fs.writeFile(abs, updated, 'utf8');
    const warning = runSecurityScan(args.path, updated);
    return warning ? `Edited ${args.path}\n\n${warning}` : `Edited ${args.path}`;
  },
};
