import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { formatArgValidationHint } from '../src/agent/prompts.js';
import { exampleToolCallLine, exampleValueFromSchema } from '../src/agent/zodSchema.js';

// Phase 6 Fix 1 & 2 — keeps the feedback loop tight when the local model
// emits tool args that don't match the Zod schema.

describe('formatArgValidationHint', () => {
  const editFileSchema = z.object({
    path: z.string(),
    oldString: z.string(),
    newString: z.string(),
  });

  it('shows the rejected payload, the validator complaint, and a corrected example', () => {
    const hint = formatArgValidationHint({
      toolName: 'edit_file',
      args: { file: 'src/foo.ts', search: 'a', replace: 'b' },
      error: 'Required at "path"',
      schema: editFileSchema,
    });

    expect(hint).toContain('<arg_validation_failed tool="edit_file">');
    expect(hint).toContain('"file": "src/foo.ts"');         // rejected payload echoed
    expect(hint).toContain('Required at "path"');             // validator complaint
    expect(hint).toContain('"name":"edit_file"');             // corrected example
    expect(hint).toContain('"path"');                         // schema explained
    expect(hint).toContain('Do NOT repeat the broken shape');
    expect(hint).toContain('</arg_validation_failed>');
  });

  it('truncates oversized args/error to keep the prompt small', () => {
    const big = 'x'.repeat(5_000);
    const hint = formatArgValidationHint({
      toolName: 'bash',
      args: { command: big },
      error: big,
      schema: z.object({ command: z.string() }),
    });
    // Whole hint stays well under 4 KB even when payload is 5 000+ chars.
    expect(hint.length).toBeLessThan(4_000);
  });

  it('handles tools whose args are unknown / open-ended', () => {
    const hint = formatArgValidationHint({
      toolName: 'web_fetch',
      args: 'just a url',
      error: 'Expected object, received string',
      schema: z.object({ url: z.string() }),
    });
    expect(hint).toContain('"url"');
    expect(hint).toContain('"name":"web_fetch"');
  });
});

describe('exampleValueFromSchema / exampleToolCallLine', () => {
  it('produces a path-flavoured stub for path-shaped keys', () => {
    const schema = z.object({ path: z.string() });
    const example = exampleValueFromSchema(schema) as { path: string };
    expect(example.path).toMatch(/\.ts$/);
  });

  it('omits optional and default fields from the example', () => {
    const schema = z.object({
      command: z.string(),
      timeout: z.number().optional(),
      shell: z.string().default('bash'),
    });
    const example = exampleValueFromSchema(schema) as Record<string, unknown>;
    expect(example).toHaveProperty('command');
    expect(example).not.toHaveProperty('timeout');
    expect(example).not.toHaveProperty('shell');
  });

  it('renders enum types as the first allowed value', () => {
    const schema = z.object({ mode: z.enum(['read', 'write', 'append']) });
    const example = exampleValueFromSchema(schema) as { mode: string };
    expect(example.mode).toBe('read');
  });

  it('exampleToolCallLine produces the exact wire format the model sees', () => {
    const line = exampleToolCallLine('read_file', z.object({ path: z.string() }));
    const parsed = JSON.parse(line);
    expect(parsed.name).toBe('read_file');
    expect(parsed.args.path).toBeTypeOf('string');
  });

  it('arrays render with one example item', () => {
    const schema = z.object({ paths: z.array(z.string()) });
    const example = exampleValueFromSchema(schema) as { paths: string[] };
    expect(Array.isArray(example.paths)).toBe(true);
    expect(example.paths.length).toBe(1);
  });

  it('handles nested objects without exploding', () => {
    const schema = z.object({
      file: z.object({ path: z.string(), encoding: z.string() }),
    });
    const example = exampleValueFromSchema(schema) as { file: { path: string; encoding: string } };
    expect(example.file).toBeTypeOf('object');
    expect(example.file.path).toBeTypeOf('string');
    expect(example.file.encoding).toBeTypeOf('string');
  });
});

// ── Round-trip: every per-tool example MUST validate against its own schema ──
//
// QA-critical: a broken example actively misleads the model. If `read_file`'s
// example renders as { path: 42 } the model will copy it and fail validation.
// This test is the canary that catches regressions in exampleValueFromSchema
// the moment they ship.

describe('per-tool example round-trip validation', () => {
  it('every TOOL_DESCRIPTORS entry has an example that passes its own Zod schema', async () => {
    const { TOOL_DESCRIPTORS } = await import('@koda/shared');
    const failures: Array<{ tool: string; reason: string }> = [];

    for (const t of TOOL_DESCRIPTORS) {
      const example = exampleValueFromSchema(t.schema);
      const parsed = t.schema.safeParse(example);
      if (!parsed.success) {
        failures.push({
          tool: t.name,
          reason: parsed.error.issues.map((i) => `${i.path.join('.')} — ${i.message}`).join('; '),
        });
      }
    }

    if (failures.length > 0) {
      const summary = failures.map((f) => `  - ${f.tool}: ${f.reason}`).join('\n');
      throw new Error(`Tool examples failed schema validation:\n${summary}`);
    }
    expect(failures).toEqual([]);
  });

  it('exampleToolCallLine is parseable JSON for every registered tool', async () => {
    const { TOOL_DESCRIPTORS } = await import('@koda/shared');
    for (const t of TOOL_DESCRIPTORS) {
      const line = exampleToolCallLine(t.name, t.schema);
      // Must be a single-line JSON object (no embedded newlines that would break the prompt).
      expect(line).not.toContain('\n');
      const parsed = JSON.parse(line);
      expect(parsed.name).toBe(t.name);
      expect(parsed).toHaveProperty('args');
    }
  });
});
