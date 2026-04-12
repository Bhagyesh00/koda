const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:4001';
const TOKEN = process.env.BACKEND_AUTH_TOKEN ?? 'dev-secret-change-me';

export async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  headers.set('authorization', `Bearer ${TOKEN}`);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
}
