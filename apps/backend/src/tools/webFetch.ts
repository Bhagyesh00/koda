import type { Tool } from './registry.js';
import { WebFetchArgs } from '@koda/shared';
import { parse } from 'node-html-parser';
import { logger } from '../logger.js';

export const webFetchTool: Tool<WebFetchArgs> = {
  name: 'web_fetch',
  description: 'Fetch a URL and return its content as plain text. Handles JS-rendered pages.',
  requiresApproval: false,
  schema: WebFetchArgs,

  async run(args) {
    const { url, maxLength = 8_000 } = args;
    logger.debug({ url }, 'web_fetch');

    // Fast path: plain fetch + HTML parse (no browser, no dependencies)
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Koda/1.0; +https://github.com/koda)',
          Accept: 'text/html,application/xhtml+xml,*/*',
        },
        signal: AbortSignal.timeout(15_000),
        redirect: 'follow',
      });

      if (!res.ok) {
        return `HTTP ${res.status} ${res.statusText} for ${url}`;
      }

      const contentType = res.headers.get('content-type') ?? '';

      // Non-HTML: return raw text (JSON, plain text, etc.)
      if (!contentType.includes('html')) {
        const text = await res.text();
        return truncate(text, maxLength);
      }

      const html = await res.text();
      const root = parse(html);

      // Remove noise
      root.querySelectorAll('script,style,noscript,nav,footer,header,aside,[aria-hidden="true"]').forEach((el) => el.remove());

      const text = root.querySelector('main,article,[role="main"]')?.innerText
        ?? root.querySelector('body')?.innerText
        ?? root.innerText;

      const cleaned = text.replace(/\n{3,}/g, '\n\n').trim();

      // If content looks like a JS SPA shell (< 200 chars of real text), fall through to Playwright
      if (cleaned.length < 200) {
        throw new Error('sparse-content');
      }

      return truncate(cleaned, maxLength);
    } catch (fastErr) {
      const isSparse = fastErr instanceof Error && fastErr.message === 'sparse-content';
      if (!isSparse) {
        logger.debug({ url, err: fastErr }, 'web_fetch fast path failed');
      }

      // Fallback: launch Playwright for JS-rendered pages
      try {
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });
        try {
          const page = await browser.newPage();
          try {
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
          } catch {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
          }
          const text = await page.innerText('body');
          return truncate(text.replace(/\n{3,}/g, '\n\n').trim(), maxLength);
        } finally {
          await browser.close();
        }
      } catch (pwErr) {
        return `Error fetching ${url}: ${pwErr instanceof Error ? pwErr.message : String(pwErr)}`;
      }
    }
  },
};

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const head = Math.floor(maxLength * 0.7);
  const tail = maxLength - head;
  const dropped = text.length - maxLength;
  return `${text.slice(0, head)}\n\n... [${dropped} characters omitted — increase maxLength to see more] ...\n\n${text.slice(-tail)}`;
}
