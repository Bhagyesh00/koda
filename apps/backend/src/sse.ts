import type { Response } from 'express';
import type { ServerEvent } from '@koda/shared';

export class SSEWriter {
  private closed = false;

  constructor(private readonly res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // Disable Nagle's algorithm so each SSE frame is sent immediately
    // instead of being coalesced with the next packet. Critical for
    // live thinking token streaming where chunks are small and frequent.
    const socket = (res as unknown as { socket?: { setNoDelay?: (v: boolean) => void } }).socket;
    socket?.setNoDelay?.(true);
    res.flushHeaders?.();
  }

  send(event: ServerEvent): void {
    if (this.closed) return;
    this.res.write(`data: ${JSON.stringify(event)}\n\n`);
    // Explicitly flush after every frame — some Node.js environments
    // buffer res.write() calls even in chunked mode.
    (this.res as unknown as { flush?: () => void }).flush?.();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.res.end();
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
