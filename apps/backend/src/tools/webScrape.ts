import type { Tool } from './registry.js';
import { WebScrapeArgs } from '@koda/shared';
import { parse } from 'node-html-parser';
import { logger } from '../logger.js';

export const webScrapeTool: Tool<typeof WebScrapeArgs._type> = {
  name: 'web_scrape',
  description: 'Scrape a URL and extract structured data — text, links, headings, or specific CSS selectors. Handles JS-rendered pages.',
  requiresApproval: false,
  schema: WebScrapeArgs,

  async run(args) {
    const { url, selector, extractAttributes, maxLength = 16_000 } = args;
    logger.debug({ url, selector }, 'web_scrape');

    // Fast path: plain fetch + node-html-parser
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Koda/1.0)',
          Accept: 'text/html,application/xhtml+xml,*/*',
        },
        signal: AbortSignal.timeout(15_000),
        redirect: 'follow',
      });

      if (!res.ok) return `HTTP ${res.status} ${res.statusText} for ${url}`;

      const html = await res.text();
      const root = parse(html);

      const output = buildOutput(root, selector, extractAttributes);

      // If the page seems to be a JS SPA shell, fall back to Playwright
      const bodyText = root.querySelector('body')?.innerText ?? '';
      if (bodyText.trim().length < 200 && !selector) {
        throw new Error('sparse-content');
      }

      return truncate(output, maxLength);
    } catch (fastErr) {
      const isSparse = fastErr instanceof Error && fastErr.message === 'sparse-content';
      if (!isSparse) {
        logger.debug({ url, err: fastErr }, 'web_scrape fast path failed, trying playwright');
      }

      // Fallback: Playwright for JS-rendered pages
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

          const parts: string[] = [];

          if (selector) {
            const matches = await page.$$eval(
              selector,
              (els, attrs) =>
                els.map((el) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const text = ((el as any).innerText?.trim() ?? el.textContent?.trim() ?? '') as string;
                  const attrMap: Record<string, string> = {};
                  if (attrs) {
                    for (const attr of attrs) {
                      const val = el.getAttribute(attr);
                      if (val !== null) attrMap[attr] = val;
                    }
                  }
                  return { text, attrs: attrMap };
                }),
              extractAttributes ?? null,
            );

            if (matches.length === 0) {
              parts.push(`No elements matched selector "${selector}".`);
            } else {
              parts.push(`## Selector: ${selector} (${matches.length} match${matches.length > 1 ? 'es' : ''})\n`);
              for (const m of matches) {
                parts.push(m.text);
                for (const [k, v] of Object.entries(m.attrs)) parts.push(`  ${k}: ${v}`);
                parts.push('');
              }
            }
          } else {
            const title = await page.title();
            if (title) parts.push(`Title: ${title}`);

            const desc = await page.$eval('meta[name="description"]', (el) => el.getAttribute('content') ?? '').catch(() => '');
            if (desc) parts.push(`Description: ${desc}`);
            parts.push('');

            const headings = await page.$$eval('h1,h2,h3,h4,h5,h6', (els) =>
              els.map((el) => ({ tag: el.tagName, text: // eslint-disable-next-line @typescript-eslint/no-explicit-any
(el as any).innerText?.trim() ?? '' })),
            );
            if (headings.length > 0) {
              parts.push(`## Headings (${headings.length})`);
              parts.push(headings.map((h) => `[${h.tag}] ${h.text}`).join('\n'));
              parts.push('');
            }

            const links = await page.$$eval('a[href]', (els) =>
              els.map((el) => ({ text: // eslint-disable-next-line @typescript-eslint/no-explicit-any
(el as any).innerText?.trim() ?? '', href: el.getAttribute('href') ?? '' })),
            );
            if (links.length > 0) {
              parts.push(`## Links (${links.length})`);
              parts.push(links.map((l) => `${l.text || '(no text)'} -> ${l.href}`).join('\n'));
            }
          }

          return truncate(parts.join('\n'), maxLength);
        } finally {
          await browser.close();
        }
      } catch (pwErr) {
        return `Error scraping ${url}: ${pwErr instanceof Error ? pwErr.message : String(pwErr)}`;
      }
    }
  },
};

function buildOutput(
  root: ReturnType<typeof parse>,
  selector?: string,
  extractAttributes?: string[],
): string {
  const parts: string[] = [];

  if (selector) {
    const matches = root.querySelectorAll(selector);
    if (matches.length === 0) {
      return `No elements matched selector "${selector}".`;
    }
    parts.push(`## Selector: ${selector} (${matches.length} match${matches.length > 1 ? 'es' : ''})\n`);
    for (const el of matches) {
      parts.push(el.innerText.trim());
      if (extractAttributes) {
        for (const attr of extractAttributes) {
          const val = el.getAttribute(attr);
          if (val !== null) parts.push(`  ${attr}: ${val}`);
        }
      }
      parts.push('');
    }
  } else {
    const title = root.querySelector('title')?.innerText?.trim();
    if (title) parts.push(`Title: ${title}`);

    const desc = root.querySelector('meta[name="description"]')?.getAttribute('content');
    if (desc) parts.push(`Description: ${desc}`);
    parts.push('');

    const headings = root.querySelectorAll('h1,h2,h3,h4,h5,h6');
    if (headings.length > 0) {
      parts.push(`## Headings (${headings.length})`);
      parts.push(headings.map((h) => `[${h.tagName}] ${h.innerText.trim()}`).join('\n'));
      parts.push('');
    }

    const links = root.querySelectorAll('a[href]');
    if (links.length > 0) {
      parts.push(`## Links (${Math.min(links.length, 50)})`);
      parts.push(
        links.slice(0, 50)
          .map((l) => `${l.innerText.trim() || '(no text)'} -> ${l.getAttribute('href') ?? ''}`)
          .join('\n'),
      );
    }
  }

  return parts.join('\n');
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + `\n... [truncated at ${maxLength} chars]`;
}
