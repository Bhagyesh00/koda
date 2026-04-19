import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool } from './registry.js';
import { RepoRefactorArgs } from '@koda/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { ollamaHeaders } from '../agent/ollama.js';

const execFileAsync = promisify(execFile);

interface EditPlan {
  path: string;
  oldString: string;
  newString: string;
  reason: string;
}

interface TestFile {
  path: string;
  content: string;
}

interface RefactorPlanResponse {
  edits: EditPlan[];
  testFiles?: TestFile[];
  summary: string;
}

async function scanFiles(workDir: string, scope: string | undefined, maxFiles: number): Promise<string[]> {
  const pattern = scope ?? '**/*.{ts,js,tsx,jsx,py,go,rs,java}';
  try {
    // Use glob via find-like shell command
    const { stdout } = await execFileAsync('node', [
      '-e',
      `
      const { globSync } = require('node:fs');
      const path = require('node:path');
      // Simple recursive scan
      const fs = require('node:fs');
      function scan(dir, pat, results = [], depth = 0) {
        if (depth > 8) return results;
        try {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) scan(full, pat, results, depth + 1);
            else if (pat.test(e.name)) results.push(full);
          }
        } catch {}
        return results;
      }
      const ext = ${JSON.stringify(scope ?? '')};
      const testPat = /\\.(ts|js|tsx|jsx|py|go|rs|java)$/;
      const files = scan(${JSON.stringify(workDir)}, testPat);
      console.log(JSON.stringify(files.slice(0, ${maxFiles})));
      `,
    ], { timeout: 10_000 });
    return JSON.parse(stdout.trim()) as string[];
  } catch {
    // Fallback: manual recursive scan
    return await recursiveScan(workDir, maxFiles);
  }
}

async function recursiveScan(dir: string, maxFiles: number, depth = 0): Promise<string[]> {
  if (depth > 8) return [];
  const CODE_EXT = /\.(ts|js|tsx|jsx|py|go|rs|java|c|cpp|cs)$/;
  const SKIP = new Set(['node_modules', 'dist', '.git', '.next', 'build', 'coverage']);
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        results.push(...await recursiveScan(full, maxFiles - results.length, depth + 1));
      } else if (CODE_EXT.test(e.name)) {
        results.push(full);
      }
      if (results.length >= maxFiles) break;
    }
  } catch { /* ignore unreadable dirs */ }
  return results;
}

async function readFileSafe(filePath: string, maxBytes = 8000): Promise<string> {
  try {
    const buf = await fs.readFile(filePath);
    const text = buf.toString('utf8', 0, maxBytes);
    return buf.length > maxBytes ? text + `\n... [truncated ${buf.length - maxBytes} bytes]` : text;
  } catch {
    return '';
  }
}

async function planEdits(
  goal: string,
  fileContents: Array<{ path: string; content: string }>,
  signal: AbortSignal | undefined,
  generateTests: boolean,
): Promise<RefactorPlanResponse> {
  const filesBlock = fileContents
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join('\n\n');

  const sys = `You are an expert software engineer producing a JSON refactor plan.
Output ONLY valid JSON matching this schema (no markdown, no extra text):
{
  "summary": "brief description of changes",
  "edits": [
    { "path": "relative/path/to/file", "oldString": "exact text to replace", "newString": "replacement text", "reason": "why" }
  ]${generateTests ? `,\n  "testFiles": [\n    { "path": "relative/path/to/test", "content": "full test file content" }\n  ]` : ''}
}
Rules:
- oldString must be an EXACT substring of the file (copy it verbatim)
- newString is the replacement
- Only include edits that directly achieve the goal
- Keep changes minimal and focused`;

  const userMsg = `Goal: ${goal}\n\nFiles:\n${filesBlock}`;

  const res = await fetch(`${config.OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: ollamaHeaders(),
    body: JSON.stringify({
      model: config.OLLAMA_MODEL,
      stream: false,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userMsg },
      ],
      options: { temperature: 0 },
    }),
    signal: signal ?? AbortSignal.timeout(180_000),
  });

  if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}`);
  const data = (await res.json()) as { message?: { content?: string } };
  const raw = (data.message?.content ?? '').trim();

  // Strip markdown fences if the model wrapped the JSON
  const json = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(json) as RefactorPlanResponse;
}

async function applyEdits(edits: EditPlan[], workDir: string, dryRun: boolean): Promise<{ applied: string[]; skipped: string[] }> {
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const edit of edits) {
    const absPath = path.isAbsolute(edit.path) ? edit.path : path.join(workDir, edit.path);
    try {
      const original = await fs.readFile(absPath, 'utf8');
      if (!original.includes(edit.oldString)) {
        skipped.push(`${edit.path} — oldString not found`);
        continue;
      }
      if (!dryRun) {
        await fs.writeFile(absPath, original.replace(edit.oldString, edit.newString), 'utf8');
      }
      applied.push(edit.path);
    } catch (err) {
      skipped.push(`${edit.path} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { applied, skipped };
}

async function runTests(workDir: string, testCommand: string | undefined, signal: AbortSignal | undefined): Promise<{ passed: boolean; output: string }> {
  // Auto-detect if no command given
  const cmd = testCommand ?? await detectTestCommand(workDir);
  if (!cmd) return { passed: true, output: 'No test command detected — skipping' };
  try {
    const [bin, ...args] = cmd.split(' ');
    const { stdout, stderr } = await execFileAsync(bin!, args, {
      cwd: workDir,
      timeout: 120_000,
      signal,
    } as Parameters<typeof execFileAsync>[2]);
    return { passed: true, output: (String(stdout) + String(stderr)).slice(0, 3000) };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { passed: false, output: ((e.stdout ?? '') + (e.stderr ?? '') + (e.message ?? '')).slice(0, 3000) };
  }
}

async function detectTestCommand(workDir: string): Promise<string | null> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(workDir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    if (pkg.scripts?.test) return 'npm test';
  } catch { /* no package.json */ }
  const files = await recursiveScan(workDir, 5);
  if (files.some((f) => f.endsWith('.test.ts') || f.endsWith('.spec.ts'))) return 'npx vitest run';
  if (files.some((f) => f.endsWith('_test.py') || f.endsWith('test_.py'))) return 'python -m pytest';
  return null;
}

export const repoRefactorTool: Tool<RepoRefactorArgs> = {
  name: 'repo_refactor',
  description: 'Single-shot multi-file refactor: scans the codebase, generates an edit plan via LLM, applies changes, optionally runs tests and self-heals.',
  requiresApproval: true,
  schema: RepoRefactorArgs,

  async run(args, ctx) {
    const workDir = ctx.workDir;
    logger.info({ goal: args.goal, scope: args.scope, dryRun: args.dryRun }, 'repo_refactor start');

    // 1. Scan files
    let files = await recursiveScan(args.scope ? path.join(workDir, args.scope.replace(/\*\*.*/, '')) : workDir, args.maxFiles);
    if (args.scope) {
      // Filter by extension pattern from scope glob
      const extMatch = args.scope.match(/\{([^}]+)\}/);
      if (extMatch) {
        const exts = extMatch[1]!.split(',').map((e) => `.${e.trim()}`);
        files = files.filter((f) => exts.some((e) => f.endsWith(e)));
      }
    }
    if (files.length === 0) return `No files found in scope: ${args.scope ?? workDir}`;

    // 2. Read file contents
    const fileContents = await Promise.all(
      files.map(async (f) => ({ path: path.relative(workDir, f), content: await readFileSafe(f) })),
    );

    // 3. Generate edit plan via LLM
    let plan: RefactorPlanResponse;
    try {
      plan = await planEdits(args.goal, fileContents, ctx.signal, args.generateTests);
    } catch (err) {
      return `Error generating refactor plan: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (args.dryRun) {
      const lines = [
        `**Repo refactor — dry run**`,
        `Goal: ${args.goal}`,
        `Summary: ${plan.summary}`,
        ``,
        `**Planned edits (${plan.edits.length}):**`,
        ...plan.edits.map((e, i) => `  ${i + 1}. ${e.path} — ${e.reason}`),
      ];
      if (plan.testFiles?.length) {
        lines.push(``, `**Test files to generate (${plan.testFiles.length}):**`);
        lines.push(...plan.testFiles.map((t) => `  - ${t.path}`));
      }
      return lines.join('\n');
    }

    // 4. Apply edits
    const { applied, skipped } = await applyEdits(plan.edits, workDir, false);

    // 5. Write test files
    const testFilesWritten: string[] = [];
    if (args.generateTests && plan.testFiles) {
      for (const tf of plan.testFiles) {
        const absPath = path.join(workDir, tf.path);
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, tf.content, 'utf8');
        testFilesWritten.push(tf.path);
      }
    }

    // 6. Run tests + self-heal loop (up to 3 iterations)
    let testResult = { passed: true, output: '' };
    if (args.runTests) {
      for (let attempt = 0; attempt < 3; attempt++) {
        testResult = await runTests(workDir, args.testCommand, ctx.signal);
        if (testResult.passed) break;
        if (attempt >= 2) break;

        // Self-heal: ask LLM to fix based on failure output
        logger.info({ attempt }, 'repo_refactor: tests failed, attempting self-heal');
        try {
          const healPrompt = `Tests failed. Fix the code to make them pass.\n\nFailure output:\n${testResult.output}\n\nApplied edits:\n${applied.map((p) => `- ${p}`).join('\n')}`;
          const healPlan = await planEdits(healPrompt, fileContents, ctx.signal, false);
          await applyEdits(healPlan.edits, workDir, false);
        } catch { break; }
      }
    }

    const lines = [
      `**Repo refactor ${testResult.passed ? 'SUCCEEDED' : 'COMPLETED (tests failing)'}**`,
      `Goal: ${args.goal}`,
      `Summary: ${plan.summary}`,
      ``,
      `Files edited (${applied.length}): ${applied.join(', ') || 'none'}`,
      skipped.length ? `Skipped (${skipped.length}): ${skipped.join('; ')}` : '',
      testFilesWritten.length ? `Test files generated: ${testFilesWritten.join(', ')}` : '',
      args.runTests ? `Tests: ${testResult.passed ? 'PASSED' : 'FAILED'}` : '',
      args.runTests && !testResult.passed ? `\nTest output:\n${testResult.output.slice(0, 1000)}` : '',
    ].filter(Boolean);

    return lines.join('\n');
  },
};
