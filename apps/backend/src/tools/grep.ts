import fg from 'fast-glob';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GrepArgs } from '@koda/shared';
import type { Tool } from './registry.js';

export const grepTool: Tool<GrepArgs> = {
  name: 'grep',
  description: 'Search file contents by regex pattern.',
  requiresApproval: false,
  schema: GrepArgs,
  async run(args, ctx) {
    const flags = args.caseInsensitive ? 'i' : '';
    let re: RegExp;
    try {
      re = new RegExp(args.pattern, flags);
    } catch (e) {
      return `Error: invalid regex: ${(e as Error).message}`;
    }

    const files = await fg(args.glob ?? '**/*', {
      cwd: ctx.workDir,
      onlyFiles: true,
      dot: false,
      followSymbolicLinks: false,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.next/**'],
    });

    const results: string[] = [];
    let count = 0;
    for (const rel of files) {
      if (count >= 200) break;
      try {
        const abs = path.join(ctx.workDir, rel);
        const stat = await fs.stat(abs);
        if (stat.size > 1_000_000) continue;
        const content = await fs.readFile(abs, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          if (re.test(line)) {
            results.push(`${rel}:${i + 1}: ${line}`);
            count++;
            if (count >= 200) break;
          }
        }
      } catch {
        // skip unreadable
      }
    }
    return results.length ? results.join('\n') : '(no matches)';
  },
};
