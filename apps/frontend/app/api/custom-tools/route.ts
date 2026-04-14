import { backendFetch } from '@/lib/serverFetch';

export async function GET() {
  const r = await backendFetch('/v1/custom-tools');
  return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } });
}

export async function POST(req: Request) {
  const r = await backendFetch('/v1/custom-tools', {
    method: 'POST',
    body: await req.text(),
    headers: { 'content-type': 'application/json' },
  });
  return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } });
}
