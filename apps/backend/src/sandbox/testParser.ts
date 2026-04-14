/**
 * Structured test output parser.
 *
 * Detects the test runner from the command string and parses stdout/stderr
 * into a normalised result object. Returns null when no test runner is
 * detected or the output cannot be parsed.
 */

export interface TestResults {
  runner: 'vitest' | 'jest' | 'pytest' | 'go-test' | 'mocha';
  passed: number;
  failed: number;
  skipped: number;
  duration?: string;
  failures: Array<{ name: string; message: string }>;
}

type Runner = TestResults['runner'];

function detectRunner(command: string): Runner | null {
  if (/\bvitest\b/.test(command)) return 'vitest';
  if (/\bjest\b/.test(command)) return 'jest';
  if (/\bpytest\b/.test(command)) return 'pytest';
  if (/\bgo\s+test\b/.test(command)) return 'go-test';
  if (/\bmocha\b/.test(command)) return 'mocha';
  // npm/pnpm/yarn test commands that likely invoke one of the above
  if (/\b(npm|pnpm|yarn)\s+(run\s+)?test\b/.test(command)) return 'jest'; // best guess
  return null;
}

// ── Vitest / Jest (ANSI text output) ─────────────────────────────────────────

function parseVitestJest(output: string): Omit<TestResults, 'runner'> {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, ''); // strip ANSI

  // Summary line examples:
  //   "Tests  3 failed | 12 passed (15)"
  //   "Test Suites: 1 failed, 3 passed, 4 total"
  //   "✓ 5 | ✗ 2 | ↓ 1"
  let passed = 0, failed = 0, skipped = 0;

  const passedMatch = /(\d+)\s+passed/.exec(clean);
  const failedMatch = /(\d+)\s+failed/.exec(clean);
  const skippedMatch = /(\d+)\s+(?:skipped|pending|todo)/.exec(clean);
  if (passedMatch) passed = parseInt(passedMatch[1]!, 10);
  if (failedMatch) failed = parseInt(failedMatch[1]!, 10);
  if (skippedMatch) skipped = parseInt(skippedMatch[1]!, 10);

  // Duration: "Duration  1.23s" or "Time: 1.234 s"
  const durMatch = /(?:Duration|Time)[:\s]+(\d[\d.,ms ]+s)/.exec(clean);
  const duration = durMatch?.[1]?.trim();

  // Extract individual failure names
  // Vitest: "● component › test name"  Jest: "✕ test name" or "FAIL src/foo.test.ts"
  const failures: TestResults['failures'] = [];
  const failureRe = /(?:●|✕|FAIL\s+\S+)\s+(.+)/g;
  let m: RegExpExecArray | null;
  while ((m = failureRe.exec(clean)) !== null && failures.length < 20) {
    const name = m[1]?.trim() ?? '';
    if (name) failures.push({ name, message: '' });
  }

  return { passed, failed, skipped, duration, failures };
}

// ── pytest ────────────────────────────────────────────────────────────────────

function parsePytest(output: string): Omit<TestResults, 'runner'> {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '');

  // "====== 2 failed, 10 passed, 1 warning in 0.43s ======"
  let passed = 0, failed = 0, skipped = 0;
  const summaryMatch = /=+ (.*?) =+$/.exec(clean.split('\n').reverse().find((l) => l.includes('=')) ?? '');
  if (summaryMatch) {
    const s = summaryMatch[1] ?? '';
    const p = /(\d+) passed/.exec(s); if (p) passed = parseInt(p[1]!, 10);
    const f = /(\d+) failed/.exec(s); if (f) failed = parseInt(f[1]!, 10);
    const sk = /(\d+) (?:skipped|deselected)/.exec(s); if (sk) skipped = parseInt(sk[1]!, 10);
  }

  const durMatch = /in\s+([\d.]+s)/.exec(clean);
  const duration = durMatch?.[1];

  // "FAILED tests/test_foo.py::test_name"
  const failures: TestResults['failures'] = [];
  const failureRe = /FAILED\s+([\w/.:_-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = failureRe.exec(clean)) !== null && failures.length < 20) {
    failures.push({ name: m[1]?.trim() ?? '', message: '' });
  }

  return { passed, failed, skipped, duration, failures };
}

// ── go test ───────────────────────────────────────────────────────────────────

function parseGoTest(output: string): Omit<TestResults, 'runner'> {
  const lines = output.split('\n');
  let passed = 0, failed = 0;
  const failures: TestResults['failures'] = [];

  for (const line of lines) {
    if (/^--- PASS:/.test(line)) passed++;
    if (/^--- FAIL:/.test(line)) {
      failed++;
      const name = /^--- FAIL:\s+(\S+)/.exec(line)?.[1] ?? '';
      if (name) failures.push({ name, message: '' });
    }
  }

  const durMatch = /^ok\s+\S+\s+([\d.]+s)/.exec(output);
  return { passed, failed, skipped: 0, duration: durMatch?.[1], failures };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function parseTestOutput(command: string, stdout: string, stderr: string): TestResults | null {
  const runner = detectRunner(command);
  if (!runner) return null;

  const combined = stdout + '\n' + stderr;
  let result: Omit<TestResults, 'runner'>;

  switch (runner) {
    case 'vitest':
    case 'jest':
    case 'mocha':
      result = parseVitestJest(combined);
      break;
    case 'pytest':
      result = parsePytest(combined);
      break;
    case 'go-test':
      result = parseGoTest(combined);
      break;
  }

  // Only return a result if we extracted at least some numbers
  if (result.passed === 0 && result.failed === 0 && result.skipped === 0) return null;

  return { runner, ...result };
}
