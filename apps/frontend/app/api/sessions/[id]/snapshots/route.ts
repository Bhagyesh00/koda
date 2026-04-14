import { backendFetch } from '@/lib/serverFetch';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await backendFetch(`/v1/sessions/${id}/snapshots`);
  return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await backendFetch(`/v1/sessions/${id}/snapshots`, {
    method: 'POST',
    body: await req.text(),
    headers: { 'content-type': 'application/json' },
  });
  return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } });
}
