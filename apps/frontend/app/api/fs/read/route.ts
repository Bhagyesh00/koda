import { backendFetch } from '@/lib/serverFetch';

export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const r = await backendFetch(`/v1/fs/read?${url.searchParams.toString()}`);
    return new Response(await r.text(), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: `cannot reach backend: ${message}` }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }
}
