import { logger } from '../../logger.js';

/**
 * Lightweight SAST-style scanner that runs after writeFile / editFile.
 * Returns a list of findings. Empty array = clean.
 */
export interface SecurityFinding {
  rule: string;
  severity: 'low' | 'medium' | 'high';
  line: number;
  message: string;
}

interface Rule {
  id: string;
  severity: 'low' | 'medium' | 'high';
  pattern: RegExp;
  message: string;
  applies?: (path: string) => boolean;
}

const RULES: Rule[] = [
  {
    id: 'hardcoded-aws-key',
    severity: 'high',
    pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/,
    message: 'Hardcoded AWS access key',
  },
  {
    id: 'hardcoded-openai-key',
    severity: 'high',
    pattern: /sk-[A-Za-z0-9]{32,}/,
    message: 'Hardcoded OpenAI-style key',
  },
  {
    id: 'private-key-block',
    severity: 'high',
    pattern: /-----BEGIN (?:RSA|OPENSSH|DSA|EC|PGP) PRIVATE KEY-----/,
    message: 'Private key material embedded in source',
  },
  {
    id: 'hardcoded-secret',
    severity: 'medium',
    pattern: /(?:api[_-]?key|apikey|password|token|secret)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/i,
    message: 'Possible hardcoded credential',
  },
  {
    id: 'eval-user-input',
    severity: 'high',
    pattern: /\beval\s*\(\s*(?:req\.|input|userInput|params|body)/,
    message: 'eval() on user-controlled input (RCE risk)',
  },
  {
    id: 'exec-shell-true',
    severity: 'high',
    pattern: /\b(?:exec|spawn|execSync)\s*\([^)]*shell:\s*true[^)]*\$\{/,
    message: 'Shell interpolation with user data (command injection)',
  },
  {
    id: 'sql-string-concat',
    severity: 'high',
    pattern: /(?:query|execute)\s*\(\s*(?:`|['"])\s*(?:SELECT|UPDATE|DELETE|INSERT)[^`'")]*\$\{/i,
    message: 'SQL string interpolation (injection risk) — use parameterised queries',
  },
  {
    id: 'insecure-md5',
    severity: 'medium',
    pattern: /createHash\s*\(\s*['"]md5['"]\s*\)/,
    message: 'MD5 is cryptographically broken — use SHA-256+',
  },
  {
    id: 'insecure-sha1',
    severity: 'medium',
    pattern: /createHash\s*\(\s*['"]sha1['"]\s*\)/,
    message: 'SHA-1 is weak — use SHA-256+',
  },
  {
    id: 'no-https',
    severity: 'low',
    pattern: /\bhttp:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)[^\s'"`]+/,
    message: 'Plaintext HTTP URL to remote host — prefer HTTPS',
  },
  {
    id: 'path-traversal',
    severity: 'high',
    pattern: /path\.(?:join|resolve)\s*\([^)]*(?:req\.|params|body)[^)]*\)/,
    message: 'User-controlled path in filesystem call (path traversal risk)',
  },
];

/**
 * Scan the given file content for insecure patterns. Returns findings with line numbers.
 */
export function scanContent(filePath: string, content: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const lines = content.split('\n');

  for (const rule of RULES) {
    if (rule.applies && !rule.applies(filePath)) continue;
    for (let i = 0; i < lines.length; i++) {
      if (rule.pattern.test(lines[i]!)) {
        findings.push({
          rule: rule.id,
          severity: rule.severity,
          line: i + 1,
          message: rule.message,
        });
      }
    }
  }
  return findings;
}

/**
 * Format findings as a compact warning block. Returns empty string if clean.
 */
export function formatFindings(filePath: string, findings: SecurityFinding[]): string {
  if (findings.length === 0) return '';
  const by = { high: 0, medium: 0, low: 0 };
  for (const f of findings) by[f.severity]++;

  const lines = [
    `⚠️  Security scan found ${findings.length} issue(s) in ${filePath}: ${by.high} high, ${by.medium} medium, ${by.low} low`,
  ];
  for (const f of findings) {
    lines.push(`  [${f.severity}] line ${f.line} (${f.rule}): ${f.message}`);
  }
  return lines.join('\n');
}

/**
 * Run the scan and log high-severity findings. Returns the formatted warning
 * so callers (writeFile/editFile tools) can append it to their tool result.
 */
export function runSecurityScan(filePath: string, content: string): string {
  const findings = scanContent(filePath, content);
  if (findings.length === 0) return '';
  const high = findings.filter((f) => f.severity === 'high');
  if (high.length > 0) {
    logger.warn({ filePath, highCount: high.length, rules: high.map((f) => f.rule) }, 'security scan: high-severity findings');
  }
  return formatFindings(filePath, findings);
}
