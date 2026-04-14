import { RunScriptArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

export const runScriptTool: Tool<typeof RunScriptArgs._type> = {
  name: 'run_script',
  description: 'Run a package.json script (e.g. "test", "build") via pnpm/npm. Requires user approval.',
  requiresApproval: true,
  schema: RunScriptArgs,
  async run(args, ctx) {
    const extraArgs = args.args && args.args.length > 0 ? args.args : undefined;
    const scriptSuffix = extraArgs ? ` ${extraArgs.join(' ')}` : '';

    let command = `pnpm run ${args.script}${scriptSuffix}`;
    let result = await runShell(command, {
      cwd: ctx.workDir,
      timeoutMs: 120_000,
      signal: ctx.signal,
    });

    // If pnpm itself is not found (not a script failure), fall back to npm run
    const stderr = result.stderr.toLowerCase();
    const isPnpmMissing =
      (stderr.includes('not found') || stderr.includes('is not recognized') || stderr.includes('cannot find')) &&
      stderr.includes('pnpm');

    if (result.exitCode !== 0 && isPnpmMissing) {
      command = `npm run ${args.script}${scriptSuffix}`;
      result = await runShell(command, {
        cwd: ctx.workDir,
        timeoutMs: 120_000,
        signal: ctx.signal,
      });
    }

    const parts: string[] = [];
    parts.push(`command: ${command}`);
    parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);

    return parts.join('\n');
  },
};
