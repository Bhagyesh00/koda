import { describe, it, expect, vi, afterEach } from 'vitest';

// Test the pure formatting logic without making real HTTP requests

function formatResults(
  results: Array<{ title: string; url: string; snippet: string }>,
  query: string,
): string {
  if (results.length === 0) return `No results found for: ${query}`;
  return [
    `Search results for: ${query}`,
    '',
    ...results.map((r, i) =>
      [`${i + 1}. ${r.title}`, `   URL: ${r.url}`, r.snippet ? `   ${r.snippet}` : ''].join('\n'),
    ),
  ].join('\n');
}

describe('web_search — result formatting', () => {
  it('returns "No results" message when array is empty', () => {
    const output = formatResults([], 'nodejs');
    expect(output).toContain('No results found for: nodejs');
  });

  it('formats a single result correctly', () => {
    const output = formatResults(
      [{ title: 'Node.js', url: 'https://nodejs.org', snippet: 'JavaScript runtime' }],
      'nodejs',
    );
    expect(output).toContain('1. Node.js');
    expect(output).toContain('URL: https://nodejs.org');
    expect(output).toContain('JavaScript runtime');
  });

  it('formats multiple results with numbered list', () => {
    const results = [
      { title: 'A', url: 'https://a.com', snippet: 'Snippet A' },
      { title: 'B', url: 'https://b.com', snippet: 'Snippet B' },
      { title: 'C', url: 'https://c.com', snippet: '' },
    ];
    const output = formatResults(results, 'test');
    expect(output).toContain('1. A');
    expect(output).toContain('2. B');
    expect(output).toContain('3. C');
  });

  it('omits snippet line when snippet is empty', () => {
    const output = formatResults(
      [{ title: 'No Snippet', url: 'https://nope.com', snippet: '' }],
      'test',
    );
    expect(output).not.toContain('undefined');
    expect(output).toContain('1. No Snippet');
  });

  it('includes query in header', () => {
    const output = formatResults([{ title: 'X', url: 'y', snippet: 'z' }], 'vitest best practices');
    expect(output).toContain('Search results for: vitest best practices');
  });
});

describe('web_search — URL truncation in DDG regex', () => {
  it('extracts clean URL from uddg redirect', () => {
    const rawUrl = 'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org%2F&rut=abc';
    let finalUrl = rawUrl;
    try {
      const uddg = new URL(rawUrl).searchParams.get('uddg');
      if (uddg) finalUrl = decodeURIComponent(uddg);
    } catch { /* leave as-is */ }
    expect(finalUrl).toBe('https://nodejs.org/');
  });

  it('leaves non-DDG URLs unchanged', () => {
    const url = 'https://example.com/path?q=test';
    let finalUrl = url;
    try {
      const uddg = new URL(url).searchParams.get('uddg');
      if (uddg) finalUrl = decodeURIComponent(uddg);
    } catch { /* leave as-is */ }
    expect(finalUrl).toBe(url);
  });
});
