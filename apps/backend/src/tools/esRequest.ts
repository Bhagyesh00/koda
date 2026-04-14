import { EsRequestArgs } from '@koda/shared';
import type { Tool } from './registry.js';

export const esRequestTool: Tool<typeof EsRequestArgs._type> = {
  name: 'es_request',
  description:
    'Make an Elasticsearch REST API request (search, mappings, indices).',
  requiresApproval: false,
  schema: EsRequestArgs,

  async run(args, ctx) {
    const baseUrl = args.baseUrl ?? 'http://localhost:9200';
    const method = args.method ?? 'GET';

    const fetchOpts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: ctx.signal,
    };

    if (args.body) {
      fetchOpts.body = args.body;
    }

    try {
      const res = await fetch(`${baseUrl}${args.path}`, fetchOpts);
      const text = await res.text();

      // Try to pretty-print JSON responses
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
