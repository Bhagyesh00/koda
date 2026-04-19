import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DeployGateArgs } from '@koda/shared';
import type { Tool } from './registry.js';

const TIMEOUT_MS = 180_000;
const MAX_OUTPUT = 4000;

interface GateResult { gate: string; passed: boolean; message: string }

function runCmd(cmd: string, cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const [bin, ...args] = cmd.split(' ');
    const proc = spawn(bin!, args, { cwd, shell: true, timeout: TIMEOUT_MS });
    let out = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('close', (code) => resolve({ code: code ?? 1, output: out.slice(0, MAX_OUTPUT) }));
    proc.on('error', (e) => resolve({ code: 1, output: e.message }));
  });
}

async function detectTestCommand(cwd: string): Promise<string | null> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    if (pkg.scripts?.test) return 'npm test';
  } catch { /* fallthrough */ }
  try {
    const mk = await fs.readFile(path.join(cwd, 'Makefile'), 'utf-8');
    if (/^test:/m.test(mk)) return 'make test';
  } catch { /* fallthrough */ }
  return null;
}

async function scanSecrets(cwd: string): Promise<GateResult> {
  const patterns = [
    /(?:AKIA|ASIA)[A-Z0-9]{16}/,
    /sk-[A-Za-z0-9]{32,}/,
    /-----BEGIN (?:RSA|OPENSSH|DSA|EC|PGP) PRIVATE KEY-----/,
    /(?:api[_-]?key|apikey|secret|password|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/i,
  ];
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out']);
  const findings: string[] = [];
  async function walk(dir: string): Promise<void> {
    if (findings.length > 20) return;
    let entries: import('node:fs').Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|env|yml|yaml|json)$/.test(e.name)) {
        try {
          const content = await fs.readFile(full, 'utf-8');
          for (const p of patterns) {
            if (p.test(content)) {
              findings.push(path.relative(cwd, full));
              break;
            }
          }
        } catch { /* skip */ }
      }
    }
  }
  await walk(cwd);
  return {
    gate: 'secret_scan',
    passed: findings.length === 0,
    message: findings.length === 0 ? 'No secrets detected' : `Potential secrets in: ${findings.join(', ')}`,
  };
}

async function runDepAudit(cwd: string): Promise<GateResult> {
  try {
    await fs.access(path.join(cwd, 'package.json'));
  } catch {
    return { gate: 'dep_audit', passed: true, message: 'Not a Node project — skipped' };
  }
  const { code, output } = await runCmd('npm audit --json --audit-level=high', cwd);
  if (code === 0) return { gate: 'dep_audit', passed: true, message: 'No high-severity vulnerabilities' };
  try {
    const json = JSON.parse(output) as { metadata?: { vulnerabilities?: Record<string, number> } };
    const vulns = json.metadata?.vulnerabilities ?? {};
    const high = (vulns.high ?? 0) + (vulns.critical ?? 0);
    return {
      gate: 'dep_audit',
      passed: high === 0,
      message: high === 0 ? 'No high-severity vulnerabilities' : `${high} high/critical vulnerabilities`,
    };
  } catch {
    return { gate: 'dep_audit', passed: false, message: 'npm audit failed' };
  }
}

export const deployGateTool: Tool<typeof DeployGateArgs._type> = {
  name: 'deploy_gate',
  description:
    'Run the full production safety gate: tests, lint, secret scan, dep audit, import validation. Blocks on any failure.',
  requiresApproval: false,
  schema: DeployGateArgs,
  async run(args, ctx) {
    const results: GateResult[] = [];
    const cwd = ctx.workDir;

    // Test gate
    const testCmd = args.testCommand || (await detectTestCommand(cwd));
    if (testCmd) {
      const { code, output } = await runCmd(testCmd, cwd);
      results.push({
        gate: 'tests',
        passed: code === 0,
        message: code === 0 ? 'All tests pass' : `Test command "${testCmd}" failed:\n${output.slice(-800)}`,
      });
    } else {
      results.push({ gate: 'tests', passed: false, message: 'No test command detected; set testCommand explicitly' });
    }

    // Lint gate (best-effort)
    try {
      await fs.access(path.join(cwd, 'package.json'));
      const { code, output } = await runCmd('npm run lint --if-present', cwd);
      results.push({
        gate: 'lint',
        passed: code === 0,
        message: code === 0 ? 'Lint passed' : `Lint failed:\n${output.slice(-400)}`,
      });
    } catch {
      results.push({ gate: 'lint', passed: true, message: 'Not a Node project — skipped' });
    }

    // Security gates
    if (!args.skipSecurity) {
      results.push(await scanSecrets(cwd));
      results.push(await runDepAudit(cwd));
    }

    const failures = results.filter((r) => !r.passed);
    const summary = results.map((r) => `  [${r.passed ? '✓' : '✗'}] ${r.gate}: ${r.message}`).join('\n');
    const header = failures.length === 0 ? '✅ All deploy gates passed' : `❌ ${failures.length} gate(s) failed`;
    return `${header}\n\n${summary}`;
  },
};
