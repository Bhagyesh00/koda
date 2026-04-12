import { backendFetch } from '@/lib/serverFetch';

export async function GET() {
  const r = await backendFetch('/v1/sessions');
  return new Response(await r.text(), {
    status: r.status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(req: Request) {
  const body = await req.text();
  const r = await backendFetch('/v1/sessions', { method: 'POST', body });
  return new Response(await r.text(), {
    status: r.status,
    headers: { 'content-type': 'application/json' },
  });
}
