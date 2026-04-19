import { backendFetch } from '@/lib/serverFetch';

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization') ?? '';
  const upstream = await backendFetch('/v1/auth/me', {
    headers: { authorization: authHeader },
  });
  const json = await upstream.json().catch(() => ({ error: 'backend error' }));
  return Response.json(json, { status: upstream.status });
}
