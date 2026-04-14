import type { z } from 'zod';

export interface ToolContext {
  sessionId: string;
  /**
   * Absolute filesystem root the tool may operate inside. This is the
   * session's `cwd` if one was set at create time, otherwise the server's
   * global WORK_DIR. Tools should sandbox all paths against this.
   */
  workDir: string;
}

export interface Tool<TArgs = unknown> {
  name: string;
  description: string;
  requiresApproval: boolean;
  schema: z.ZodType<TArgs, z.ZodTypeDef, any>;
  run(args: TArgs, ctx: ToolContext): Promise<string>;
}

const registry = new Map<string, Tool>();

export function registerTool<T>(tool: Tool<T>): void {
  registry.set(tool.name, tool as Tool);
}

export function getTool(name: string): Tool | undefined {
  return registry.get(name);
}

export function listTools(): Tool[] {
  return Array.from(registry.values());
}
