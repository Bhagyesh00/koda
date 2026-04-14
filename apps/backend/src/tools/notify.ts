import { NotifyArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { spawn } from 'node:child_process';

/**
 * Escape single quotes for safe embedding inside single-quoted PowerShell strings.
 * Replaces every `'` with `''` (PowerShell convention).
 */
function escapeSingleQuotes(str: string): string {
  return str.replace(/'/g, "''");
}

/**
 * Escape a string for embedding inside a double-quoted AppleScript string.
 * AppleScript has no backslash escape, so double quotes are represented via
 * the built-in `quote` constant: `"before" & quote & "after"`.
 */
function escapeAppleScript(str: string): string {
  return str.split('"').join('" & quote & "');
}

export const notifyTool: Tool<typeof NotifyArgs._type> = {
  name: 'notify',
  description: 'Send a desktop notification to the user. Use when a long task finishes.',
  requiresApproval: false,
  schema: NotifyArgs,
  async run(args, _ctx) {
    const title = escapeSingleQuotes(args.title);
    const body = escapeSingleQuotes(args.body);

    if (process.platform === 'win32') {
      // Run detached via PowerShell — MessageBox is blocking inside PS but we
      // launch the whole PS process detached so we don't await it.
      const psScript =
        `Add-Type -AssemblyName System.Windows.Forms; ` +
        `[System.Windows.Forms.MessageBox]::Show('${body}', '${title}')`;
      const child = spawn('powershell', ['-Command', psScript], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    } else if (process.platform === 'darwin') {
      const script = `display notification "${escapeAppleScript(args.body)}" with title "${escapeAppleScript(args.title)}"`;
      const child = spawn('osascript', ['-e', script], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    } else {
      // Linux — assumes notify-send is available (libnotify)
      const child = spawn('notify-send', [args.title, args.body], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    }

    return `Notification sent: ${args.title}`;
  },
};
