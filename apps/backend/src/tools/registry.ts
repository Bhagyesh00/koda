import type { z } from 'zod';
import type { SSEWriter } from '../sse.js';

export interface ToolContext {
  sessionId: string;
  /**
   * Absolute filesystem root the tool may operate inside. This is the
   * session's `cwd` if one was set at create time, otherwise the server's
   * global WORK_DIR. Tools should sandbox all paths against this.
   */
  workDir: string;
  /** Forwarded from the HTTP request — fires when the client disconnects or hits abort. */
  signal?: AbortSignal;
  /**
   * Optional SSE writer for tools that want to stream progress events
   * (e.g. agent_spawn forwarding sub-agent activity). Tools must guard with
   * `?.` since unit tests construct contexts without it.
   */
  sse?: SSEWriter;
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
