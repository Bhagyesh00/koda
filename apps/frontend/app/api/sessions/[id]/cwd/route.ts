import { backendFetch } from '@/lib/serverFetch';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.text();
  const r = await backendFetch(`/v1/sessions/${id}/cwd`, {
    method: 'PATCH',
    body,
    headers: { 'content-type': 'application/json' },
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { 'content-type': 'application/json' },
  });
}
