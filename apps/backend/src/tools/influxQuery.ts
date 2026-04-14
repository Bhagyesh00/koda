import { InfluxQueryArgs } from '@koda/shared';
import type { Tool } from './registry.js';

export const influxQueryTool: Tool<typeof InfluxQueryArgs._type> = {
  name: 'influx_query',
  description:
    'Run a Flux or InfluxQL query against InfluxDB.',
  requiresApproval: false,
  schema: InfluxQueryArgs,

  async run(args, ctx) {
    const baseUrl = args.url ?? 'http://localhost:8086';
    const orgParam = args.org ? `?org=${encodeURIComponent(args.org)}` : '';
    const url = `${baseUrl}/api/v2/query${orgParam}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/vnd.flux',
    };
    if (args.token) {
      headers['Authorization'] = `Token ${args.token}`;
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: args.query,
        signal: ctx.signal,
      });

      const text = await res.text();

      // Try to pretty-print if JSON, otherwise return as-is (likely CSV)
      let body: string;
      try {
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        body = text;
      }

      return `status: ${res.status}\n${body}`;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `error: ${message}`;
    }
  },
};
