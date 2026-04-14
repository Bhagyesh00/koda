import { HttpRequestArgs } from '@koda/shared';
import type { Tool } from './registry.js';

export const httpRequestTool: Tool<typeof HttpRequestArgs._type> = {
  name: 'http_request',
  description: 'Make an HTTP request and return status, headers, and body. Like curl but structured.',
  requiresApproval: false,
  schema: HttpRequestArgs,

  async run(args, ctx) {
    const { url, method = 'GET', headers: customHeaders, body, timeoutMs = 10_000 } = args;

    const fetchHeaders: Record<string, string> = {
      'User-Agent': 'Koda/1.0',
      ...(customHeaders ?? {}),
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: fetchHeaders,
        body: body ?? undefined,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // Format response headers
    const responseHeaders: string[] = [];
    res.headers.forEach((value, key) => {
      responseHeaders.push(`${key}: ${value}`);
    });

    // Read body and truncate
    let responseBody: string;
    try {
      responseBody = await res.text();
    } catch (err) {
      responseBody = `(Error reading body: ${err instanceof Error ? err.message : String(err)})`;
    }

    const MAX_BODY = 16_000;
    if (responseBody.length > MAX_BODY) {
      responseBody = responseBody.slice(0, MAX_BODY) + `\n... [truncated at ${MAX_BODY} chars]`;
    }

    return `HTTP ${res.status} ${res.statusText}\n\nHeaders:\n${responseHeaders.join('\n')}\n\nBody:\n${responseBody}`;
  },
};
