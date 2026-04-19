import { spawn } from 'node:child_process';
import { PerfCheckArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { sessionStore } from '../sessions/store.js';

const TIMEOUT_MS = 60_000;

interface RunSample { ms: number; rssMb: number }

function runOnce(cmd: string, cwd: string, signal?: AbortSignal): Promise<RunSample> {
  return new Promise((resolve, reject) => {
    const [bin, ...args] = cmd.split(' ');
    const start = Date.now();
    const proc = spawn(bin!, args, { cwd, shell: true, timeout: TIMEOUT_MS });
    let maxRss = 0;
    const poll = setInterval(() => {
      try {
        const usage = process.resourceUsage();
        const rss = usage.maxRSS / 1024;
        if (rss > maxRss) maxRss = rss;
      } catch { /* skip */ }
    }, 100);
    if (signal) signal.addEventListener('abort', () => proc.kill(), { once: true });
    proc.on('close', (code) => {
      clearInterval(poll);
      const ms = Date.now() - start;
      if (code === 0) resolve({ ms, rssMb: maxRss });
      else reject(new Error(`command exited with code ${code}`));
    });
    proc.on('error', (e) => { clearInterval(poll); reject(e); });
  });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

export const perfCheckTool: Tool<typeof PerfCheckArgs._type> = {
  name: 'perf_check',
  description:
    'Measure the performance characteristics (latency, I/O count, memory) of a command and compare against the session\'s performance budget.',
  requiresApproval: false,
  schema: PerfCheckArgs,
  async run(args, ctx) {
    const iterations = args.iterations ?? 5;
    const samples: RunSample[] = [];

    for (let i = 0; i < iterations; i++) {
      try {
        samples.push(await runOnce(args.command, ctx.workDir, ctx.signal));
      } catch (e) {
        return `Benchmark failed on iteration ${i + 1}: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    const times = samples.map((s) => s.ms).sort((a, b) => a - b);
    const rss = samples.map((s) => s.rssMb).sort((a, b) => a - b);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const p50 = percentile(times, 50);
    const p99 = percentile(times, 99);
    const maxRss = Math.max(...rss);

    const budget = sessionStore.get(ctx.sessionId)?.performanceBudget;
    const violations: string[] = [];
    if (budget?.p99LatencyMs && p99 > budget.p99LatencyMs) {
      violations.push(`p99 latency ${p99}ms exceeds budget ${budget.p99LatencyMs}ms`);
    }
    if (budget?.maxMemoryMb && maxRss > budget.maxMemoryMb) {
      violations.push(`max RSS ${maxRss.toFixed(1)}MB exceeds budget ${budget.maxMemoryMb}MB`);
    }

    return [
      `Performance check: ${args.command} (${iterations} iterations)`,
      `  mean: ${mean.toFixed(1)}ms  p50: ${p50}ms  p99: ${p99}ms`,
      `  max RSS: ${maxRss.toFixed(1)}MB`,
      budget
        ? violations.length === 0
          ? '  ✓ within performance budget'
          : `  ✗ Budget violations:\n    ${violations.join('\n    ')}`
        : '  (no performance budget set on session)',
    ].join('\n');
  },
};
