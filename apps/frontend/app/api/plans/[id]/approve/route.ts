import { backendFetch } from '@/lib/serverFetch';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await backendFetch(`/v1/plans/${id}/approve`, { method: 'POST' });
  return new Response(await r.text(), {
    status: r.status,
    headers: { 'content-type': 'application/json' },
  });
}
