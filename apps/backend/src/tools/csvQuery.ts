import { CsvQueryArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';
import { resolveInside } from '../sandbox/fs.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const csvQueryTool: Tool<typeof CsvQueryArgs._type> = {
  name: 'csv_query',
  description:
    'Run SQL queries against a CSV file using sqlite3. Treats the CSV as a table named "data".',
  requiresApproval: false,
  schema: CsvQueryArgs,

  async run(args, ctx) {
    const absPath = resolveInside(ctx.workDir, args.file);
    const sql = shellEscape(args.sql);
    const escapedPath = shellEscape(absPath);

    const cmd = `sqlite3 :memory: -header -csv ".import '${escapedPath}' data" "${sql}"`;

    const result = await runShell(cmd, { cwd: ctx.workDir, signal: ctx.signal });

    const parts: string[] = [];
    parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    return parts.join('\n');
  },
};
