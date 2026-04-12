import { backendFetch } from '@/lib/serverFetch';

export async function POST(req: Request, ctx: { params: Promise<{ callId: string }> }) {
  const { callId } = await ctx.params;
  const body = await req.text();
  const r = await backendFetch(`/v1/approve/${callId}`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { 'content-type': 'application/json' },
  });
}
