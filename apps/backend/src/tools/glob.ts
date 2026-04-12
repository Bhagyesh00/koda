import fg from 'fast-glob';
import { GlobArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { resolveInside } from '../sandbox/fs.js';

export const globTool: Tool<typeof GlobArgs._type> = {
  name: 'glob',
  description: 'Find files by glob pattern (e.g. "**/*.ts").',
  requiresApproval: false,
  schema: GlobArgs,
  async run(args, ctx) {
    const cwd = args.cwd ? resolveInside(ctx.workDir, args.cwd) : ctx.workDir;
    const matches = await fg(args.pattern, {
      cwd,
      dot: false,
      onlyFiles: true,
      followSymbolicLinks: false,
      ignore: ['**/node_modules/**', '**/.git/**'],
      absolute: false,
    });
    if (matches.length === 0) return '(no matches)';
    return matches.slice(0, 500).join('\n');
  },
};
