import { backendFetch } from '@/lib/serverFetch';

export async function POST(req: Request) {
  const body = await req.text();
  const r = await backendFetch('/v1/tts', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  });
  const contentType = r.headers.get('content-type') ?? 'audio/mpeg';
  const buf = await r.arrayBuffer();
  return new Response(buf, {
    status: r.status,
    headers: { 'content-type': contentType },
  });
}
