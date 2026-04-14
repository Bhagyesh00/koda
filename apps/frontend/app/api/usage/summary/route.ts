import { backendFetch } from '@/lib/serverFetch';

export async function GET() {
  try {
    const r = await backendFetch('/v1/usage/summary');
    return new Response(await r.text(), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 502, headers: { 'content-type': 'application/json' } });
  }
}
