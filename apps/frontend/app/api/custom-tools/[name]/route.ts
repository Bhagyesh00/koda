import { backendFetch } from '@/lib/serverFetch';

export async function PUT(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const r = await backendFetch(`/v1/custom-tools/${name}`, {
    method: 'PUT',
    body: await req.text(),
    headers: { 'content-type': 'application/json' },
  });
  return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const r = await backendFetch(`/v1/custom-tools/${name}`, { method: 'DELETE' });
  return new Response(null, { status: r.status });
}
