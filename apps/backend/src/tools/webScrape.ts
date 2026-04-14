import { WebScrapeArgs } from '@koda/shared';
import type { Tool } from './registry.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Decode common HTML entities to plain text. */
function decodeEntities(html: string): string {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Strip tags and return inner text. */
function innerText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).trim();
}

/**
 * Basic regex-based CSS selector extraction.
 * Supports: tag selectors, #id selectors, .class selectors.
 */
function applySelector(html: string, selector: string): string[] {
  let pattern: string;

  if (selector.startsWith('#')) {
    // ID selector: match elements with id="value"
    const id = shellEscape(selector.slice(1));
    pattern = `<[^>]+id\\s*=\\s*["']${id}["'][^>]*>[\\s\\S]*?<\\/[^>]+>`;
  } else if (selector.startsWith('.')) {
    // Class selector: match elements whose class attribute contains the value
    const cls = shellEscape(selector.slice(1));
    pattern = `<[^>]+class\\s*=\\s*["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>[\\s\\S]*?<\\/[^>]+>`;
  } else {
    // Tag selector
    const tag = shellEscape(selector);
    pattern = `<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`;
  }

  const regex = new RegExp(pattern, 'gi');
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    matches.push(m[0]);
  }
  return matches;
}

/** Extract specified HTML attributes from a chunk of HTML. */
function extractAttrs(html: string, attributes: string[]): Record<string, string>[] {
  const results: Record<string, string>[] = [];
  const tagRegex = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let tag: RegExpExecArray | null;
  while ((tag = tagRegex.exec(html)) !== null) {
    const attrString = tag[2] ?? '';
    const record: Record<string, string> = {};
    let found = false;
    for (const attr of attributes) {
      const attrMatch = new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrString);
      if (attrMatch) {
        record[attr] = attrMatch[1] ?? '';
        found = true;
      }
    }
    if (found) results.push(record);
  }
  return results;
}

export const webScrapeTool: Tool<typeof WebScrapeArgs._type> = {
  name: 'web_scrape',
  description: 'Scrape a URL and extract structured data — text, links, headings, or specific CSS selectors.',
  requiresApproval: false,
  schema: WebScrapeArgs,

  async run(args, ctx) {
    const { url, selector, extractAttributes, maxLength = 16_000 } = args;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Koda/1.0; +https://github.com/koda)',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: ctx.signal,
      });
    } catch (err) {
      return `Error fetching ${url}: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (!res.ok) {
      return `HTTP ${res.status} ${res.statusText} for ${url}`;
    }

    let html: string;
    try {
      html = await res.text();
    } catch (err) {
      return `Error reading response body: ${err instanceof Error ? err.message : String(err)}`;
    }

    const parts: string[] = [];

    // If a selector is provided, extract matching elements
    if (selector) {
      const matched = applySelector(html, selector);
      if (matched.length === 0) {
        parts.push(`No elements matched selector "${selector}".`);
      } else {
        parts.push(`## Selector: ${selector} (${matched.length} match${matched.length > 1 ? 'es' : ''})\n`);
        if (extractAttributes && extractAttributes.length > 0) {
          for (const chunk of matched) {
            const attrs = extractAttrs(chunk, extractAttributes);
            const text = innerText(chunk);
            parts.push(`Text: ${text}`);
            for (const record of attrs) {
              for (const [k, v] of Object.entries(record)) {
                parts.push(`  ${k}: ${v}`);
              }
            }
            parts.push('');
          }
        } else {
          for (const chunk of matched) {
            parts.push(innerText(chunk));
          }
        }
      }
    } else {
      // Default extraction: title, meta description, headings, links

      // Title
      const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
      if (titleMatch) {
        parts.push(`Title: ${innerText(titleMatch[1] ?? '')}`);
      }

      // Meta description
      const metaMatch = /<meta\s+[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/i.exec(html)
        ?? /<meta\s+[^>]*content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["'][^>]*>/i.exec(html);
      if (metaMatch) {
        parts.push(`Description: ${decodeEntities(metaMatch[1] ?? '')}`);
      }

      parts.push('');

      // Headings
      const headingRegex = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi;
      const headings: string[] = [];
      let hMatch: RegExpExecArray | null;
      while ((hMatch = headingRegex.exec(html)) !== null) {
        const level = (hMatch[1] ?? 'h?').toUpperCase();
        headings.push(`[${level}] ${innerText(hMatch[2] ?? '')}`);
      }
      if (headings.length > 0) {
        parts.push(`## Headings (${headings.length})`);
        parts.push(headings.join('\n'));
        parts.push('');
      }

      // Links
      const linkRegex = /<a\s+[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
      const links: string[] = [];
      let lMatch: RegExpExecArray | null;
      while ((lMatch = linkRegex.exec(html)) !== null) {
        const href = decodeEntities(lMatch[1] ?? '');
        const text = innerText(lMatch[2] ?? '');
        if (text || href) {
          links.push(`${text || '(no text)'} -> ${href}`);
        }
      }
      if (links.length > 0) {
        parts.push(`## Links (${links.length})`);
        parts.push(links.join('\n'));
      }
    }

    let output = parts.join('\n');

    // Truncate to maxLength
    if (output.length > maxLength) {
      output = output.slice(0, maxLength) + `\n... [truncated at ${maxLength} chars]`;
    }

    return output;
  },
};
