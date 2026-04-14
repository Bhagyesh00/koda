import { SecretScanArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const DEFAULT_PATTERNS = [
  // AWS access key IDs
  'AKIA[0-9A-Z]{16}',
  // Generic API keys
  '(?i)(api[_-]?key|apikey)\\s*[:=]\\s*[\'"][^\'"]{8,}',
  // Passwords
  '(?i)(password|passwd|pwd)\\s*[:=]\\s*[\'"][^\'"]+',
  // Private keys
  '-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----',
  // Tokens and secrets
  '(?i)(token|secret|bearer)\\s*[:=]\\s*[\'"][^\'"]{8,}',
  // Connection strings
  '(?i)(postgres|mysql|mongodb|redis)://[^\\s\'"]+',
];

export const secretScanTool: Tool<typeof SecretScanArgs._type> = {
  name: 'secret_scan',
  description: 'Scan files for leaked secrets, API keys, passwords, and credentials.',
  requiresApproval: false,
  schema: SecretScanArgs,

  async run(args, ctx) {
    const { path = '.', patterns = DEFAULT_PATTERNS } = args;
    const escapedPath = shellEscape(path);

    const findings: string[] = [];

    for (const pattern of patterns) {
      const escapedPattern = shellEscape(pattern);
      const cmd = `grep -rn -E "${escapedPattern}" "${escapedPath}" --include="*" --exclude-dir=node_modules --exclude-dir=.git`;

      const result = await runShell(cmd, { cwd: ctx.workDir, signal: ctx.signal });

      if (result.ok && result.stdout.trim()) {
        const lines = result.stdout.trim().split('\n');
        for (const line of lines) {
          findings.push(line);
        }
      }
      // grep returns exit code 1 when no matches — that's not an error
    }

    if (findings.length === 0) {
      return `No secrets found in "${path}".`;
    }

    // Deduplicate in case patterns overlap
    const unique = [...new Set(findings)];

    const parts: string[] = [];
    parts.push(`## Secret Scan Results (${unique.length} finding${unique.length > 1 ? 's' : ''})\n`);
    for (const finding of unique) {
      parts.push(`  ${finding}`);
    }

    return parts.join('\n');
  },
};
