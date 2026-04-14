import { backendFetch } from '@/lib/serverFetch';

export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const r = await backendFetch(`/v1/fs/list?${url.searchParams.toString()}`);
    return new Response(await r.text(), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    // Backend unreachable (not running, wrong port, network) — surface a JSON error
    // so the FolderPicker can show a helpful message instead of "(500)".
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({
        error: `cannot reach backend: ${message}. Is the backend running on the configured port?`,
      }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }
}
