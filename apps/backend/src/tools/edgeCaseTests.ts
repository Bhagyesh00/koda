import { promises as fs } from 'node:fs';
import path from 'node:path';
import { EdgeCaseTestsArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { streamOllamaChat, type OllamaMessage } from '../agent/ollama.js';

const MAX_SOURCE_CHARS = 6000;

function defaultTestPath(sourcePath: string): string {
  const ext = path.extname(sourcePath);
  const base = sourcePath.slice(0, -ext.length);
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) return `${base}.test${ext}`;
  if (ext === '.py') return `${path.dirname(sourcePath)}/test_${path.basename(base)}.py`;
  return `${base}.test${ext}`;
}

export const edgeCaseTestsTool: Tool<typeof EdgeCaseTestsArgs._type> = {
  name: 'edge_case_tests',
  description:
    'Generate edge-case and boundary-condition tests for a specific function or file using an LLM.',
  requiresApproval: false,
  schema: EdgeCaseTestsArgs,
  async run(args, ctx) {
    const abs = path.isAbsolute(args.targetFile) ? args.targetFile : path.join(ctx.workDir, args.targetFile);
    let source: string;
    try {
      source = await fs.readFile(abs, 'utf-8');
    } catch (e) {
      return `Error reading target: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (source.length > MAX_SOURCE_CHARS) {
      source = source.slice(0, MAX_SOURCE_CHARS) + '\n// [truncated]';
    }

    const prompt =
      `You are a senior QA engineer writing rigorous tests. Generate tests that specifically target edge cases, ` +
      `boundary conditions, and failure modes — NOT just the happy path.\n\n` +
      `Source file: ${args.targetFile}\n` +
      (args.functionName ? `Focus on function: ${args.functionName}\n` : '') +
      `\nEdge cases to systematically cover:\n` +
      `1. Empty/null/undefined inputs\n` +
      `2. Minimum and maximum boundary values (off-by-one)\n` +
      `3. Invalid types or malformed input\n` +
      `4. Concurrent/race conditions (if applicable)\n` +
      `5. Resource exhaustion (large inputs, deep recursion)\n` +
      `6. Security: injection, path traversal, prototype pollution\n` +
      `7. Unicode / locale edge cases for strings\n` +
      `8. Numeric edge cases: 0, negatives, Infinity, NaN, float precision\n\n` +
      `Source code:\n\`\`\`\n${source}\n\`\`\`\n\n` +
      `Respond with the complete test file only. Use the testing framework that fits the project (vitest/jest/pytest). ` +
      `No prose, no markdown fences — just runnable code.`;

    const messages: OllamaMessage[] = [
      { role: 'system', content: 'You write comprehensive test suites focused on edge cases. Output only code.' },
      { role: 'user', content: prompt },
    ];

    let out = '';
    try {
      await streamOllamaChat(
        messages,
        (delta) => { out += delta; },
        ctx.signal,
        { temperature: 0.2 },
      );
    } catch (e) {
      return `Error generating tests: ${e instanceof Error ? e.message : String(e)}`;
    }

    // Strip any accidental markdown fences
    out = out.trim().replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');

    const outPath = args.outPath
      ? (path.isAbsolute(args.outPath) ? args.outPath : path.join(ctx.workDir, args.outPath))
      : defaultTestPath(abs);

    try {
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, out, 'utf-8');
    } catch (e) {
      return `Error writing test file: ${e instanceof Error ? e.message : String(e)}`;
    }

    return `Generated edge-case tests: ${path.relative(ctx.workDir, outPath)}\n(${out.split('\n').length} lines)`;
  },
};
