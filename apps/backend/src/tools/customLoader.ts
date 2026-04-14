import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { registerTool } from './registry.js';
import { runShell } from '../sandbox/exec.js';
import { logger } from '../logger.js';

export const CustomArgSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean']).default('string'),
  description: z.string().default(''),
  required: z.boolean().default(true),
});

export const CustomToolDefSchema = z.object({
  name: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/, 'must be snake_case'),
  description: z.string().min(1),
  requiresApproval: z.boolean().default(true),
  command: z.string().min(1),
  args: z.array(CustomArgSchema).default([]),
});

export type CustomToolDef = z.infer<typeof CustomToolDefSchema>;
export type CustomArg = z.infer<typeof CustomArgSchema>;

/**
 * Build a Zod schema from the custom arg definitions so the agent loop
 * can validate and parse arguments.
 */
function buildArgSchema(args: CustomArg[]): z.ZodType<Record<string, unknown>, z.ZodTypeDef, any> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const arg of args) {
    let base: z.ZodTypeAny =
      arg.type === 'number'
        ? z.number()
        : arg.type === 'boolean'
        ? z.boolean()
        : z.string();
    if (!arg.required) base = base.optional();
    shape[arg.name] = base;
  }
  return z.object(shape);
}

/**
 * Interpolate `{argName}` placeholders in the command template.
 */
function interpolate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    args[key] !== undefined ? String(args[key]) : '',
  );
}

/**
 * Register a custom tool definition in the tool registry.
 */
export function registerCustomTool(def: CustomToolDef): void {
  const schema = buildArgSchema(def.args);
  registerTool({
    name: def.name,
    description: def.description,
    requiresApproval: def.requiresApproval,
    schema,
    async run(args, ctx) {
      const cmd = interpolate(def.command, args as Record<string, unknown>);
      const result = await runShell(cmd, { cwd: ctx.workDir });
      const out = (result.stdout + (result.stderr ? `\n${result.stderr}` : '')).trim();
      return out || (result.ok ? '(no output)' : `exited with code ${result.exitCode}`);
    },
  });
  logger.info({ name: def.name }, 'registered custom tool');
}

/**
 * Load all *.json files from `<workDir>/.koda/custom-tools/` and register them.
 */
export function loadCustomTools(workDir: string): void {
  const dir = path.join(workDir, '.koda', 'custom-tools');
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const def = CustomToolDefSchema.parse(raw);
      registerCustomTool(def);
    } catch (err) {
      logger.warn({ file, err }, 'failed to load custom tool');
    }
  }
}

/**
 * Persist a custom tool definition to disk.
 */
export function saveCustomTool(workDir: string, def: CustomToolDef): void {
  const dir = path.join(workDir, '.koda', 'custom-tools');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${def.name}.json`), JSON.stringify(def, null, 2));
}

/**
 * Delete a custom tool definition from disk.
 */
export function deleteCustomToolFile(workDir: string, name: string): void {
  const file = path.join(workDir, '.koda', 'custom-tools', `${name}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/**
 * List all persisted custom tool definitions.
 */
export function listCustomToolDefs(workDir: string): CustomToolDef[] {
  const dir = path.join(workDir, '.koda', 'custom-tools');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      try {
        return [CustomToolDefSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))];
      } catch {
        return [];
      }
    });
}
