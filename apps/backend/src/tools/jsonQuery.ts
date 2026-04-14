import { JsonQueryArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';
import { resolveInside } from '../sandbox/fs.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const jsonQueryTool: Tool<typeof JsonQueryArgs._type> = {
  name: 'json_query',
  description:
    'Run jq expressions against a JSON file and return the result.',
  requiresApproval: false,
  schema: JsonQueryArgs,

  async run(args, ctx) {
    const absPath = resolveInside(ctx.workDir, args.file);
    const expression = shellEscape(args.expression);
    const escapedPath = shellEscape(absPath);

    const cmd = `jq "${expression}" "${escapedPath}"`;

    const result = await runShell(cmd, { cwd: ctx.workDir, signal: ctx.signal });

    const parts: string[] = [];
    parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    return parts.join('\n');
  },
};
