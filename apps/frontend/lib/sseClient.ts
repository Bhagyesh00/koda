import type { ServerEvent, SessionMode } from '@koda/shared';

export interface ChatStreamHandlers {
  onEvent: (event: ServerEvent) => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
}

/**
 * POST to /api/chat and parse the SSE response stream.
 * Returns an AbortController that can cancel the stream.
 */
export function startChatStream(
  body: { sessionId: string; message: string; mode?: SessionMode },
  handlers: ChatStreamHandlers,
): AbortController {
  const ac = new AbortController();
  (async () => {
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`chat failed: ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          try {
            const event = JSON.parse(json) as ServerEvent;
            handlers.onEvent(event);
          } catch (e) {
            handlers.onError?.(e as Error);
          }
        }
      }
      handlers.onClose?.();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        handlers.onError?.(err as Error);
      }
      handlers.onClose?.();
    }
  })();
  return ac;
}
