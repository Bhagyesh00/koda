import { BashArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';
import { getShellCwd, setShellCwd, trackCd } from '../sandbox/shellState.js';

export const bashTool: Tool<typeof BashArgs._type> = {
  name: 'bash',
  description: 'Run a shell command in the working directory. Requires user approval.',
  requiresApproval: true,
  schema: BashArgs,
  async run(args, ctx) {
    // Use the session's persisted shell CWD so that `cd` commands from previous
    // turns are still in effect (mirrors a real terminal session).
    const shellCwd = getShellCwd(ctx.sessionId, ctx.workDir);

    const result = await runShell(args.command, { cwd: shellCwd, timeoutMs: args.timeoutMs });

    // Track any `cd` calls so the next bash turn starts in the right directory.
    const newCwd = trackCd(args.command, shellCwd);
    if (newCwd !== shellCwd) {
      setShellCwd(ctx.sessionId, newCwd);
    }

    const parts: string[] = [];
    // Show current directory so the user always knows where they are.
    parts.push(`cwd: ${newCwd}`);
    parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    return parts.join('\n');
  },
};
