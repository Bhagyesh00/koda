import { backendFetch } from '@/lib/serverFetch';

export async function POST(req: Request) {
  const body = await req.text();
  const upstream = await backendFetch('/v1/auth/register', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  });
  const json = await upstream.json().catch(() => ({ error: 'backend error' }));
  return Response.json(json, { status: upstream.status });
}
