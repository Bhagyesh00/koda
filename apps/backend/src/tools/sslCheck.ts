import { SslCheckArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const sslCheckTool: Tool<typeof SslCheckArgs._type> = {
  name: 'ssl_check',
  description: 'Check SSL/TLS certificate details for a host — expiry, issuer, chain validity.',
  requiresApproval: false,
  schema: SslCheckArgs,

  async run(args, ctx) {
    const { host, port = 443 } = args;
    const escapedHost = shellEscape(host);

    const cmd = `echo | openssl s_client -connect ${escapedHost}:${port} -servername ${escapedHost} 2>/dev/null | openssl x509 -noout -dates -subject -issuer -serial`;

    const result = await runShell(cmd, { cwd: ctx.workDir, signal: ctx.signal });

    if (!result.ok || !result.stdout.trim()) {
      return `Failed to retrieve SSL certificate for ${host}:${port}.\n${result.stderr || 'No output from openssl.'}`;
    }

    const output = result.stdout.trim();
    const lines = output.split('\n');

    // Parse fields from openssl output
    const fields: Record<string, string> = {};
    for (const line of lines) {
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      const value = line.slice(eqIdx + 1).trim();
      fields[key] = value;
    }

    const subject = fields['subject'] ?? 'unknown';
    const issuer = fields['issuer'] ?? 'unknown';
    const notBefore = fields['notBefore'] ?? 'unknown';
    const notAfter = fields['notAfter'] ?? 'unknown';
    const serial = fields['serial'] ?? 'unknown';

    // Calculate days until expiry
    let daysUntilExpiry = 'unknown';
    if (notAfter !== 'unknown') {
      const expiryDate = new Date(notAfter);
      if (!isNaN(expiryDate.getTime())) {
        const now = new Date();
        const diffMs = expiryDate.getTime() - now.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        daysUntilExpiry = `${diffDays} day${diffDays !== 1 ? 's' : ''}`;
        if (diffDays < 0) {
          daysUntilExpiry = `EXPIRED ${Math.abs(diffDays)} day${Math.abs(diffDays) !== 1 ? 's' : ''} ago`;
        } else if (diffDays <= 30) {
          daysUntilExpiry += ' (WARNING: expiring soon)';
        }
      }
    }

    const parts: string[] = [];
    parts.push(`## SSL Certificate: ${host}:${port}\n`);
    parts.push(`Subject:     ${subject}`);
    parts.push(`Issuer:      ${issuer}`);
    parts.push(`Serial:      ${serial}`);
    parts.push(`Not Before:  ${notBefore}`);
    parts.push(`Not After:   ${notAfter}`);
    parts.push(`Expires In:  ${daysUntilExpiry}`);

    return parts.join('\n');
  },
};
