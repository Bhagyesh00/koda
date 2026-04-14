import { backendFetch } from '@/lib/serverFetch';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; ruleId: string }> }) {
  const { id, ruleId } = await ctx.params;
  const r = await backendFetch(`/v1/sessions/${id}/guardrails/${ruleId}`, {
    method: 'PATCH', body: await req.text(), headers: { 'content-type': 'application/json' },
  });
  return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; ruleId: string }> }) {
  const { id, ruleId } = await ctx.params;
  const r = await backendFetch(`/v1/sessions/${id}/guardrails/${ruleId}`, { method: 'DELETE' });
  return new Response(null, { status: r.status });
}
