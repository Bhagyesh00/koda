import { backendFetch } from '@/lib/serverFetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await req.text();
  const upstream = await backendFetch('/v1/chat', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return new Response(text || 'backend error', { status: upstream.status });
  }

  // Manually pump the upstream stream into a fresh ReadableStream. Passing
  // `upstream.body` directly into `new Response(...)` in Next.js dev (Webpack)
  // buffers the whole stream before the client sees anything, which defeats
  // SSE. An explicit pump enqueues each chunk as it arrives.
  const upstreamReader = upstream.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await upstreamReader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      upstreamReader.cancel(reason).catch(() => {});
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
