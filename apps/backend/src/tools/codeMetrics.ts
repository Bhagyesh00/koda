import { CodeMetricsArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const codeMetricsTool: Tool<typeof CodeMetricsArgs._type> = {
  name: 'code_metrics',
  description:
    'Compute code metrics — lines of code, file counts, and breakdown by extension.',
  requiresApproval: false,
  schema: CodeMetricsArgs,

  async run(args, ctx) {
    const p = shellEscape(args.path ?? '.');

    if (args.glob) {
      const g = shellEscape(args.glob);
      // File count
      const fcResult = await runShell(
        `find "${p}" -name "${g}" | wc -l`,
        { cwd: ctx.workDir, signal: ctx.signal },
      );
      // Line count
      const lcResult = await runShell(
        `find "${p}" -name "${g}" -exec cat {} + | wc -l`,
        { cwd: ctx.workDir, signal: ctx.signal },
      );

      const fileCount = fcResult.stdout.trim();
      const lineCount = lcResult.stdout.trim();

      const parts: string[] = [];
      parts.push(`Files matching "${args.glob}" in ${args.path ?? '.'}: ${fileCount}`);
      parts.push(`Total lines: ${lineCount}`);
      if (fcResult.stderr) parts.push(`stderr: ${fcResult.stderr.trim()}`);
      return parts.join('\n');
    }

    // Default: use git ls-files (more portable, especially on Windows)
    const fileListResult = await runShell(
      `git ls-files "${p}"`,
      { cwd: ctx.workDir, signal: ctx.signal },
    );

    if (fileListResult.exitCode !== 0) {
      return `Failed to list files: ${fileListResult.stderr.trim()}`;
    }

    const files = fileListResult.stdout.trim();
    if (!files) {
      return `No tracked files found in ${args.path ?? '.'}.`;
    }

    // Total file count
    const fileCount = files.split('\n').filter(Boolean).length;

    // Total line count
    const lcResult = await runShell(
      `git ls-files "${p}" | xargs wc -l | tail -1`,
      { cwd: ctx.workDir, signal: ctx.signal },
    );

    // Breakdown by extension
    const extResult = await runShell(
      `git ls-files "${p}" | sed 's/.*\\.//' | sort | uniq -c | sort -rn | head -20`,
      { cwd: ctx.workDir, signal: ctx.signal },
    );

    const parts: string[] = [];
    parts.push(`Total tracked files: ${fileCount}`);
    parts.push(`Total lines: ${lcResult.stdout.trim()}`);
    if (extResult.stdout.trim()) {
      parts.push(`\nBreakdown by extension:`);
      parts.push(extResult.stdout.trim());
    }
    return parts.join('\n');
  },
};
