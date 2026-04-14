import { ServiceHealthArgs } from '@koda/shared';
import type { Tool } from './registry.js';

export const serviceHealthTool: Tool<typeof ServiceHealthArgs._type> = {
  name: 'service_health',
  description: 'Check if an HTTP service is healthy by hitting its URL and verifying the status code.',
  requiresApproval: false,
  schema: ServiceHealthArgs,

  async run(args, ctx) {
    const { url, expectedStatus = 200, timeoutMs = 5_000 } = args;

    const start = Date.now();

    // Try HEAD first, fall back to GET
    let res: Response | undefined;
    let lastError: string | undefined;

    for (const method of ['HEAD', 'GET'] as const) {
      try {
        res = await fetch(url, {
          method,
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
        });
        break; // success — stop trying
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        // If HEAD failed, try GET
        if (method === 'HEAD') continue;
      }
    }

    const latency = Date.now() - start;

    if (!res) {
      return `\u2717 ${url} \u2014 unreachable (${lastError ?? 'unknown error'})`;
    }

    if (res.status === expectedStatus) {
      return `\u2713 ${url} \u2014 HTTP ${res.status} (${latency}ms)`;
    }

    return `\u2717 ${url} \u2014 HTTP ${res.status} (expected ${expectedStatus}, ${latency}ms)`;
  },
};
