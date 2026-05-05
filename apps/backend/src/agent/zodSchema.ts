import { z } from 'zod';

/**
 * Lightweight zod-to-JSON-schema converter for our tool schemas.
 * Only handles the shapes we actually use (object, string, number, boolean, array, optional, default, enum).
 */
export function zodToJsonSchemaLite(schema: z.ZodTypeAny): unknown {
  const def = schema._def;
  const typeName = def.typeName as string;

  switch (typeName) {
    case 'ZodString':
      return { type: 'string' };
    case 'ZodNumber':
      return { type: 'number' };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodEnum':
      return { type: 'string', enum: def.values };
    case 'ZodArray':
      return { type: 'array', items: zodToJsonSchemaLite(def.type) };
    case 'ZodOptional':
    case 'ZodDefault':
      return zodToJsonSchemaLite(def.innerType);
    case 'ZodObject': {
      const shape = def.shape() as Record<string, z.ZodTypeAny>;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchemaLite(value);
        const inner = value._def.typeName;
        if (inner !== 'ZodOptional' && inner !== 'ZodDefault') required.push(key);
      }
      return { type: 'object', properties, required };
    }
    case 'ZodUnknown':
      return {};
    default:
      return {};
  }
}

/**
 * Generate a deterministic example value from a Zod schema. Used to render
 * per-tool JSON examples in the system prompt — small local models generalise
 * far better from concrete examples than from prose schemas.
 *
 * Stub picks are intentionally domain-flavoured: paths look like paths,
 * commands look like commands. The `fieldHints` map lets callers override on
 * a per-key basis (e.g. `command` should render as a real shell line).
 */
export function exampleValueFromSchema(
  schema: z.ZodTypeAny,
  key?: string,
  opts: { includeOptionals?: boolean } = {},
): unknown {
  const def = schema._def;
  const typeName = def.typeName as string;
  switch (typeName) {
    case 'ZodOptional':
    case 'ZodDefault':
    case 'ZodNullable':
    case 'ZodReadonly':
    case 'ZodLazy':
      return exampleValueFromSchema(def.innerType ?? def.getter?.(), key, opts);
    // Schemas wrapped by .refine() / .transform() / .pipe() lose ZodObject
    // identity at the top level. Unwrap so the inner shape is examined.
    // Forcing includeOptionals=true here covers the common refine pattern
    // "either fieldA or fieldB is required" — refines are opaque to us, so
    // populating optionals maximises the chance the example satisfies the rule.
    case 'ZodEffects':
      return exampleValueFromSchema(def.schema, key, { ...opts, includeOptionals: true });
    case 'ZodPipeline':
      return exampleValueFromSchema(def.in, key, opts);
    case 'ZodNumber': {
      // Honour .min(N) — examples must satisfy their own range constraints.
      const checks = (def.checks ?? []) as Array<{ kind: string; value?: number }>;
      const min = checks.find((c) => c.kind === 'min')?.value;
      const isInt = checks.some((c) => c.kind === 'int');
      const base = min !== undefined ? Math.max(min, 1) : 1;
      return isInt ? Math.ceil(base) : base;
    }
    case 'ZodBoolean':
      return true;
    case 'ZodLiteral':
      return def.value;
    case 'ZodEnum': {
      const values = def.values as readonly string[];
      return values[0] ?? 'value';
    }
    case 'ZodNativeEnum': {
      const values = Object.values(def.values as Record<string, string | number>);
      return values[0] ?? 'value';
    }
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const options = (def.options ?? []) as z.ZodTypeAny[];
      // Pick the first option — produces a valid example for at least one branch.
      return options.length > 0
        ? exampleValueFromSchema(options[0]!, key, opts)
        : stubStringForKey(key);
    }
    case 'ZodArray': {
      // Respect min-length constraints so e.g. `z.array(...).min(2)` renders
      // as a 2-element example. Without this the example fails its own schema.
      const minLength = (def.minLength?.value as number | undefined) ?? 1;
      const exactLength = (def.exactLength?.value as number | undefined);
      const count = Math.max(1, exactLength ?? minLength);
      const items: unknown[] = [];
      for (let i = 0; i < count; i++) items.push(exampleValueFromSchema(def.type, key, opts));
      return items;
    }
    case 'ZodObject': {
      const shape = def.shape() as Record<string, z.ZodTypeAny>;
      const out: Record<string, unknown> = {};
      // When opts.includeOptionals=true (e.g. inside a refine wrapper), include
      // optional fields too — they're often what the refine is checking for.
      // Once we've populated this object, drop the flag so deeper nested
      // optionals stay omitted (otherwise the example bloats).
      const childOpts = opts.includeOptionals ? {} : opts;
      for (const [k, v] of Object.entries(shape)) {
        const inner = v._def.typeName;
        const isOpt = inner === 'ZodOptional' || inner === 'ZodDefault';
        if (isOpt && !opts.includeOptionals) continue;
        out[k] = exampleValueFromSchema(v, k, childOpts);
      }
      return out;
    }
    case 'ZodRecord':
      return { example: exampleValueFromSchema(def.valueType, key, opts) };
    case 'ZodTuple': {
      const items = (def.items ?? []) as z.ZodTypeAny[];
      return items.map((item, i) => exampleValueFromSchema(item, `${key ?? 'tuple'}[${i}]`, opts));
    }
    case 'ZodString': {
      // Honour z.string().url() / .email() / .uuid() — these have format checks
      // that override the key-based stub. Otherwise the example fails its own
      // schema (e.g. `imageUrl: "value"` rejects under .url()).
      const checks = (def.checks ?? []) as Array<{ kind: string; value?: number }>;
      if (checks.some((c) => c.kind === 'url')) return 'https://example.com/file.png';
      if (checks.some((c) => c.kind === 'email')) return 'user@example.com';
      if (checks.some((c) => c.kind === 'uuid')) return '00000000-0000-0000-0000-000000000000';
      const min = checks.find((c) => c.kind === 'min')?.value;
      const stub = stubStringForKey(key);
      if (min !== undefined && stub.length < min) return stub.padEnd(min, '_');
      return stub;
    }
    case 'ZodAny':
    case 'ZodUnknown':
      return stubStringForKey(key);
    default:
      return stubStringForKey(key);
  }
}

function stubStringForKey(key?: string): string {
  if (!key) return 'example';
  const k = key.toLowerCase();
  if (k === 'path' || k.endsWith('path')) return 'src/index.ts';
  if (k === 'file' || k.endsWith('file')) return 'src/index.ts';
  if (k === 'dir' || k.endsWith('dir')) return 'src';
  if (k === 'pattern') return '*.ts';
  if (k === 'query') return 'TODO';
  if (k === 'command' || k === 'cmd') {
    return process.platform === 'win32' ? 'dir' : 'ls';
  }
  if (k === 'oldstring' || k === 'oldtext' || k === 'search') return 'const x = 1';
  if (k === 'newstring' || k === 'newtext' || k === 'replace') return 'const x = 2';
  if (k === 'content' || k === 'body' || k === 'text') return 'hello world';
  if (k === 'description' || k === 'reason' || k === 'summary') return 'short description';
  if (k === 'name' || k === 'title' || k === 'label') return 'example';
  if (k === 'url') return 'https://example.com';
  return 'value';
}

/**
 * Compose a one-line `{"name":"<tool>","args":{...}}` example for a tool.
 * Used by `renderToolDocs()` in prompts.ts.
 */
export function exampleToolCallLine(toolName: string, schema: z.ZodTypeAny): string {
  const args = exampleValueFromSchema(schema);
  return JSON.stringify({ name: toolName, args });
}
