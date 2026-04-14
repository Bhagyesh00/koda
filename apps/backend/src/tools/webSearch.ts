import type { Tool } from './registry.js';
import { WebSearchArgs } from '@koda/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Strip HTML tags and decode entities — used for cleaning scraped snippets. */
function strip(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Search via Brave Search API (requires BRAVE_SEARCH_API_KEY in env).
 * Returns null when the key is not configured.
 */
async function braveSearch(query: string, maxResults: number): Promise<SearchResult[] | null> {
  if (!config.BRAVE_SEARCH_API_KEY) return null;

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}&text_decorations=false`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': config.BRAVE_SEARCH_API_KEY,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    logger.warn({ status: res.status }, 'brave search failed');
    return null;
  }

  const data = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };

  return (data.web?.results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.description ?? '',
  }));
}

/**
 * Fallback: DuckDuckGo HTML search — no API key required.
 * Scrapes the public HTML results page with regex.
 */
async function duckDuckGoSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Koda/1.0)',
      Accept: 'text/html',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`DuckDuckGo returned HTTP ${res.status}`);
  }

  const html = await res.text();
  const results: SearchResult[] = [];

  // Each result block: <div class="result results_links_deep web-result"> ... </div>
  // Title link:   <a rel="nofollow" class="result__a" href="...">Title</a>
  // Snippet link: <a class="result__snippet" ...>Snippet text</a>
  const blockRe = /<div[^>]+class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  const titleRe = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/;
  const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/;

  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null && results.length < maxResults) {
    const block = match[1] ?? '';
    const titleMatch = titleRe.exec(block);
    const snippetMatch = snippetRe.exec(block);
    if (!titleMatch) continue;

    // DDG result URLs are redirect links — extract the actual URL from uddg param
    const rawHref = titleMatch[1] ?? '';
    let finalUrl = rawHref;
    try {
      const uddg = new URL('https://duckduckgo.com' + rawHref).searchParams.get('uddg');
      if (uddg) finalUrl = decodeURIComponent(uddg);
    } catch {
      // leave as-is
    }

    results.push({
      title: strip(titleMatch[2] ?? ''),
      url: finalUrl,
      snippet: snippetMatch ? strip(snippetMatch[1] ?? '') : '',
    });
  }

  return results;
}

/** Format results as readable text for the model. */
function formatResults(results: SearchResult[], query: string): string {
  if (results.length === 0) return `No results found for: ${query}`;
  return [
    `Search results for: ${query}`,
    '',
    ...results.map((r, i) =>
      [`${i + 1}. ${r.title}`, `   URL: ${r.url}`, r.snippet ? `   ${r.snippet}` : ''].join('\n'),
    ),
  ].join('\n');
}

export const webSearchTool: Tool<WebSearchArgs> = {
  name: 'web_search',
  description: 'Search the web and return results with titles, URLs, and snippets.',
  requiresApproval: false,
  schema: WebSearchArgs,

  async run(args) {
    const { query, maxResults = 8 } = args;
    logger.debug({ query, maxResults }, 'web_search');

    try {
      // Prefer Brave (higher quality) when API key is set; fall back to DDG.
      const results =
        (await braveSearch(query, maxResults)) ??
        (await duckDuckGoSearch(query, maxResults));

      return formatResults(results, query);
    } catch (err) {
      return `Search failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
