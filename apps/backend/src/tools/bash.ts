import fs from 'node:fs';
import { BashArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';
import { getShellCwd, setShellCwd, trackCd } from '../sandbox/shellState.js';

/**
 * On Windows, cmd.exe does not have Unix commands like `rm`, `ls`, `cp`, etc.
 * When the shell reports "not recognized", extract the failing command and
 * suggest the PowerShell equivalent so the model can retry immediately.
 */
function windowsAlternativeHint(command: string, stderr: string): string | null {
  if (process.platform !== 'win32') return null;
  if (!stderr.toLowerCase().includes('is not recognized') &&
      !stderr.toLowerCase().includes('cannot find') &&
      !stderr.toLowerCase().includes('not found')) return null;

  const cmd = command.trim().split(/\s+/)[0]?.toLowerCase() ?? '';

  const table: Record<string, string> = {
    rm:    `Remove-Item ${command.replace(/^rm\s*/, '')}`.trim(),
    ls:    'Get-ChildItem',
    cp:    `Copy-Item ${command.replace(/^cp\s*/, '')}`.trim(),
    mv:    `Move-Item ${command.replace(/^mv\s*/, '')}`.trim(),
    cat:   `Get-Content ${command.replace(/^cat\s*/, '')}`.trim(),
    touch: `New-Item ${command.replace(/^touch\s*/, '')} -ItemType File`.trim(),
    find:  'Get-ChildItem -Recurse',
    grep:  `Select-String ${command.replace(/^grep\s*(-[rn]+\s*)?/, '')}`.trim(),
    pwd:   'Get-Location',
    which: `Get-Command ${command.replace(/^which\s*/, '')}`.trim(),
    clear: 'Clear-Host',
  };

  const suggestion = table[cmd];
  if (!suggestion) return null;

  return `\n⚠ "${cmd}" is not available in cmd.exe on Windows.\nRetry with PowerShell: powershell -Command "${suggestion.replace(/"/g, '\\"')}"`;
}

export const bashTool: Tool<typeof BashArgs._type> = {
  name: 'bash',
  description: 'Run a shell command in the working directory. Requires user approval.',
  requiresApproval: true,
  schema: BashArgs,
  async run(args, ctx) {
    // Use the session's persisted shell CWD so that `cd` commands from previous
    // turns are still in effect (mirrors a real terminal session).
    let shellCwd = getShellCwd(ctx.sessionId, ctx.workDir);

    // Self-heal a stale shell cwd. The persisted cwd can become invalid if a
    // previous `cd` landed somewhere that's since been deleted, OR if a series
    // of compounding `cd` commands built a non-existent nested path before
    // trackCd's existence check was added. Recover to the workspace root and
    // surface the recovery so the model knows.
    const recoveryNotes: string[] = [];
    if (!fs.existsSync(shellCwd)) {
      recoveryNotes.push(
        `(shell cwd ${shellCwd} no longer exists — recovered to workspace root ${ctx.workDir})`,
      );
      shellCwd = ctx.workDir;
      setShellCwd(ctx.sessionId, ctx.workDir);
    }

    // Resolve any `cd` directives BEFORE running the command. The previous
    // implementation did this after, so an in-command `cd` was tracked but
    // could resolve to a non-existent path that future calls inherited.
    // trackCd now refuses non-existent targets and reports them as warnings.
    const tracked = trackCd(args.command, shellCwd);
    if (tracked.cwd !== shellCwd) {
      setShellCwd(ctx.sessionId, tracked.cwd);
    }

    const result = await runShell(args.command, { cwd: shellCwd, timeoutMs: args.timeoutMs, signal: ctx.signal });

    const parts: string[] = [];
    // Show current directory so the user always knows where they are.
    parts.push(`cwd: ${tracked.cwd}`);
    parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    for (const note of recoveryNotes) parts.push(note);
    for (const warning of tracked.warnings) parts.push(`⚠ ${warning}`);
    if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);

    // On Windows, when a Unix command is not recognized, append the PowerShell
    // alternative directly in the output so the model retries without guessing.
    if (result.exitCode !== 0) {
      const hint = windowsAlternativeHint(args.command, result.stderr);
      if (hint) parts.push(hint);
    }

    return parts.join('\n');
  },
};
