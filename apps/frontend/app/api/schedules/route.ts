import { backendFetch } from '@/lib/serverFetch';

export const dynamic = 'force-dynamic';

export async function GET() {
  const upstream = await backendFetch('/v1/schedules');
  const json = await upstream.json().catch(() => ({}));
  return Response.json(json, { status: upstream.status });
}

export async function POST(req: Request) {
  const body = await req.text();
  const upstream = await backendFetch('/v1/schedules', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  });
  const json = await upstream.json().catch(() => ({}));
  return Response.json(json, { status: upstream.status });
}
