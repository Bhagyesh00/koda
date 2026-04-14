import { backendFetch } from '@/lib/serverFetch';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await backendFetch(`/v1/sessions/${id}/messages`, { method: 'DELETE' });
  return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } });
}
