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
    const shellCwd = getShellCwd(ctx.sessionId, ctx.workDir);

    const result = await runShell(args.command, { cwd: shellCwd, timeoutMs: args.timeoutMs, signal: ctx.signal });

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

    // On Windows, when a Unix command is not recognized, append the PowerShell
    // alternative directly in the output so the model retries without guessing.
    if (result.exitCode !== 0) {
      const hint = windowsAlternativeHint(args.command, result.stderr);
      if (hint) parts.push(hint);
    }

    return parts.join('\n');
  },
};
