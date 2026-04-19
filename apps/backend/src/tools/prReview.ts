import { spawn } from 'node:child_process';
import { PrReviewArgs, DiffSummarizeArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { streamOllamaChat, type OllamaMessage } from '../agent/ollama.js';

const MAX_DIFF_CHARS = 20_000;

function gitDiff(base: string, head: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', ['diff', '--unified=3', `${base}...${head}`], { cwd });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    proc.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(err || `git diff exit ${code}`)));
    proc.on('error', reject);
  });
}

function gitChangedFiles(base: string, head: string, cwd: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', ['diff', '--name-only', `${base}...${head}`], { cwd });
    let out = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('close', (code) => code === 0 ? resolve(out.split('\n').filter(Boolean)) : reject(new Error(`exit ${code}`)));
    proc.on('error', reject);
  });
}

function detectRisks(diff: string): string[] {
  const risks: string[] = [];
  if (/^\+.*(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"]/im.test(diff)) risks.push('Potential credential in diff');
  if (/^\+.*\beval\s*\(/m.test(diff)) risks.push('New eval() call');
  if (/^\+.*\bexec\s*\([^)]*shell:\s*true/m.test(diff)) risks.push('Shell invocation with shell:true');
  if (/^\+.*-----BEGIN [A-Z ]+ PRIVATE KEY-----/m.test(diff)) risks.push('Private key added to diff');
  if (/^-.*\btest\(|^-.*\bit\(/m.test(diff) && !/^\+.*\btest\(|^\+.*\bit\(/m.test(diff)) risks.push('Tests removed without replacement');
  if (/^\+.*process\.env\./m.test(diff)) risks.push('New env var reference — ensure .env.example updated');
  if (/^\+.*--force|^\+.*--no-verify/m.test(diff)) risks.push('Destructive/bypass flag added');
  if (/^\+.*TODO|^\+.*FIXME|^\+.*XXX/m.test(diff)) risks.push('TODO/FIXME introduced');
  return risks;
}

export const prReviewTool: Tool<typeof PrReviewArgs._type> = {
  name: 'pr_review',
  description:
    'Review a git diff: summary + per-file confidence score + risk flags. Compresses large diffs into reviewable summaries.',
  requiresApproval: false,
  schema: PrReviewArgs,
  async run(args, ctx) {
    let diff: string;
    let files: string[];
    try {
      [diff, files] = await Promise.all([
        gitDiff(args.base, args.head, ctx.workDir),
        gitChangedFiles(args.base, args.head, ctx.workDir),
      ]);
    } catch (e) {
      return `Error reading diff: ${e instanceof Error ? e.message : String(e)}`;
    }

    if (!diff.trim()) return `No changes between ${args.base} and ${args.head}`;

    const risks = detectRisks(diff);
    const added = (diff.match(/^\+(?!\+\+)/gm) ?? []).length;
    const removed = (diff.match(/^-(?!--)/gm) ?? []).length;

    // Heuristic confidence: shrinks as risks grow, diff size grows, and test-files-touched-ratio drops
    const testFiles = files.filter((f) => /\.(test|spec)\./.test(f) || /^tests?\//.test(f));
    const testRatio = files.length === 0 ? 0 : testFiles.length / files.length;
    let confidence = 1.0;
    confidence -= risks.length * 0.15;
    confidence -= Math.min(0.3, (added + removed) / 1000 * 0.1);
    if (testRatio < 0.2 && files.length > 3) confidence -= 0.2;
    confidence = Math.max(0.1, Math.min(1.0, confidence));

    // LLM-powered compressed summary (only if diff is reasonably sized)
    let llmSummary = '';
    if (diff.length < MAX_DIFF_CHARS) {
      const messages: OllamaMessage[] = [
        { role: 'system', content: 'You are a senior code reviewer. Produce a compact, factual review. No fluff.' },
        {
          role: 'user',
          content:
            `Review this diff. Produce output in this exact structure:\n\n` +
            `## What changed\n- bullet per meaningful change\n\n` +
            `## Concerns\n- bullet per concern (security, correctness, style)\n\n` +
            `## Suggestions\n- bullet per actionable suggestion\n\n` +
            `Keep total length under 300 words.\n\n` +
            `Diff:\n\`\`\`diff\n${diff}\n\`\`\``,
        },
      ];
      try {
        await streamOllamaChat(messages, (d) => { llmSummary += d; }, ctx.signal, { temperature: 0.2 });
      } catch {
        llmSummary = '(LLM summary unavailable)';
      }
    } else {
      llmSummary = `(diff too large for LLM summary: ${diff.length} chars > ${MAX_DIFF_CHARS})`;
    }

    return [
      `# PR Review: ${args.base}...${args.head}`,
      ``,
      `**Files changed:** ${files.length} (${testFiles.length} test files)`,
      `**Lines:** +${added} / -${removed}`,
      `**Confidence:** ${(confidence * 100).toFixed(0)}%`,
      ``,
      `## Risk flags (${risks.length})`,
      ...(risks.length === 0 ? ['- (none)'] : risks.map((r) => `- ⚠️  ${r}`)),
      ``,
      llmSummary.trim(),
    ].join('\n');
  },
};

export const diffSummarizeTool: Tool<typeof DiffSummarizeArgs._type> = {
  name: 'diff_summarize',
  description:
    'Produce a short, structured summary of a git diff including change categories, impact analysis, and test coverage assessment.',
  requiresApproval: false,
  schema: DiffSummarizeArgs,
  async run(args, ctx) {
    let diff: string;
    try {
      diff = await gitDiff(args.base, args.head, ctx.workDir);
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (!diff.trim()) return `No changes between ${args.base} and ${args.head}`;

    const truncated = diff.length > MAX_DIFF_CHARS ? diff.slice(0, MAX_DIFF_CHARS) + '\n// [truncated]' : diff;

    const messages: OllamaMessage[] = [
      { role: 'system', content: 'You summarise diffs concisely. Output only the summary, no preamble.' },
      {
        role: 'user',
        content:
          `Summarise this diff in ≤${args.maxLines ?? 400} tokens. Format:\n\n` +
          `**Category**: feat | fix | refactor | docs | chore | test | security\n` +
          `**Scope**: 1-3 words (area of the code)\n` +
          `**Summary**: one paragraph\n` +
          `**Notable files**: bullets\n` +
          `**Test coverage**: added | modified | none | n/a\n\n` +
          `Diff:\n\`\`\`diff\n${truncated}\n\`\`\``,
      },
    ];

    let out = '';
    try {
      await streamOllamaChat(messages, (d) => { out += d; }, ctx.signal, { temperature: 0.1 });
    } catch (e) {
      return `LLM error: ${e instanceof Error ? e.message : String(e)}`;
    }
    return out.trim();
  },
};
