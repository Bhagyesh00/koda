import { backendFetch } from '@/lib/serverFetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // Forward the multipart form data to the backend as-is
  const contentType = req.headers.get('content-type') ?? '';
  const body = await req.arrayBuffer();

  const upstream = await backendFetch('/v1/upload', {
    method: 'POST',
    body,
    headers: { 'content-type': contentType },
  });

  const json = await upstream.json().catch(() => ({ error: 'upload failed' }));
  return Response.json(json, { status: upstream.status });
}
