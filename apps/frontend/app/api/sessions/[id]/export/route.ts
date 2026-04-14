import { backendFetch } from '@/lib/serverFetch';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await backendFetch(`/v1/sessions/${id}/export`);
  const body = await r.text();
  return new Response(body, {
    status: r.status,
    headers: {
      'content-type': r.headers.get('content-type') ?? 'text/markdown',
      'content-disposition': r.headers.get('content-disposition') ?? `attachment; filename="session-${id}.md"`,
    },
  });
}
