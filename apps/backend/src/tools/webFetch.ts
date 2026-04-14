import type { Tool } from './registry.js';
import { WebFetchArgs } from '@koda/shared';
import { logger } from '../logger.js';

/** Strip HTML tags and decode common entities, returning readable plain text. */
function htmlToText(html: string): string {
  // Remove <script> and <style> blocks entirely (content is not useful)
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Convert block-level tags to newlines so paragraphs are preserved
  text = text.replace(/<\/?(p|div|section|article|header|footer|nav|main|aside|h[1-6]|li|tr|blockquote|pre|br)[^>]*>/gi, '\n');
  // Remove all remaining tags
  text = text.replace(/<[^>]+>/g, '');
  // Decode the most common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
  // Collapse runs of spaces/tabs, but preserve intentional blank lines
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n[ \t]+/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

export const webFetchTool: Tool<WebFetchArgs> = {
  name: 'web_fetch',
  description: 'Fetch a URL and return its content as plain text.',
  requiresApproval: false,
  schema: WebFetchArgs,

  async run(args) {
    const { url, maxLength = 8_000 } = args;

    logger.debug({ url }, 'web_fetch');

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          // Identify as a browser to avoid bot-blocking on common docs sites
          'User-Agent':
            'Mozilla/5.0 (compatible; Koda/1.0; +https://github.com/koda)',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      return `Error fetching ${url}: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (!res.ok) {
      return `HTTP ${res.status} ${res.statusText} for ${url}`;
    }

    const contentType = res.headers.get('content-type') ?? '';
    let body: string;
    try {
      body = await res.text();
    } catch (err) {
      return `Error reading response body: ${err instanceof Error ? err.message : String(err)}`;
    }

    // Convert HTML to plain text; leave non-HTML responses (JSON, plain text) as-is
    const isHtml = contentType.includes('html') || body.trimStart().startsWith('<!');
    const text = isHtml ? htmlToText(body) : body;

    if (text.length <= maxLength) return text;

    // Return head + tail so both the top of the page and any trailing content
    // (e.g. API signatures at the bottom of a doc page) are visible.
    const head = Math.floor(maxLength * 0.7);
    const tail = maxLength - head;
    const dropped = text.length - maxLength;
    return `${text.slice(0, head)}\n\n... [${dropped} characters omitted — increase maxLength to see more] ...\n\n${text.slice(-tail)}`;
  },
};
