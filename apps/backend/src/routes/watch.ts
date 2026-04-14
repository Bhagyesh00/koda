import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { sessionStore } from '../sessions/store.js';
import { SSEWriter } from '../sse.js';
import { config } from '../config.js';
import { registerWatchConnection, startWatchingPath } from '../watch/watcher.js';
import { NotFoundError } from '../errors.js';

export const watchRouter: RouterType = Router();

watchRouter.get('/sessions/:id/watch', (req, res) => {
  const session = sessionStore.get(req.params.id ?? '');
  if (!session) throw new NotFoundError('session');

  const watchPath = session.cwd ?? config.WORK_DIR_ABS;
  const sse = new SSEWriter(res);

  // Start watching the path (idempotent — only creates one watcher per path)
  startWatchingPath(req.params.id!, watchPath);

  // Register this SSE connection so it receives events
  const unregister = registerWatchConnection(req.params.id!, sse);

  // Keep the connection alive with periodic pings
  const keepAlive = setInterval(() => {
    if (sse.isClosed) {
      clearInterval(keepAlive);
      return;
    }
    res.write(': ping\n\n');
  }, 25_000);

  // Single close handler — unregister, stop pings, close SSE writer
  req.on('close', () => {
    clearInterval(keepAlive);
    unregister();
    sse.close();
  });
});
