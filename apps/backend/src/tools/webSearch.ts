import type { Tool } from './registry.js';
import { WebSearchArgs } from '@koda/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

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

async function searxngSearch(query: string, maxResults: number): Promise<SearchResult[] | null> {
  if (!config.SEARXNG_URL) return null;

  const url = new URL('/search', config.SEARXNG_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('categories', 'general');

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, 'searxng search failed');
      return null;
    }

    const data = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };

    return (data.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.content ?? '',
    }));
  } catch (err) {
    logger.warn({ err }, 'searxng search error');
    return null;
  }
}

async function duckDuckGoSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  // DDG HTML API — no Playwright needed, just fetch the HTML and parse manually
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Koda/1.0)',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) return [];
    const html = await res.text();

    // Extract results using lightweight regex — avoids Playwright dependency
    const results: SearchResult[] = [];
    const resultRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

    const titles: Array<{ url: string; title: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = resultRegex.exec(html)) !== null && titles.length < maxResults) {
      const rawUrl = m[1] ?? '';
      const rawTitle = (m[2] ?? '').replace(/<[^>]+>/g, '').trim();
      let finalUrl = rawUrl;
      try {
        const uddg = new URL(rawUrl).searchParams.get('uddg');
        if (uddg) finalUrl = decodeURIComponent(uddg);
      } catch { /* leave as-is */ }
      if (rawTitle && finalUrl.startsWith('http')) titles.push({ url: finalUrl, title: rawTitle });
    }

    const snippets: string[] = [];
    while ((m = snippetRegex.exec(html)) !== null) {
      snippets.push((m[1] ?? '').replace(/<[^>]+>/g, '').trim());
    }

    for (let i = 0; i < titles.length; i++) {
      results.push({ title: titles[i]!.title, url: titles[i]!.url, snippet: snippets[i] ?? '' });
    }

    return results;
  } catch (err) {
    logger.warn({ err }, 'ddg fallback search error');
    return [];
  }
}

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
      // Priority: Brave API → SearxNG → DuckDuckGo HTML
      const results =
        (await braveSearch(query, maxResults)) ??
        (await searxngSearch(query, maxResults)) ??
        (await duckDuckGoSearch(query, maxResults));
      return formatResults(results, query);
    } catch (err) {
      return `Search failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
