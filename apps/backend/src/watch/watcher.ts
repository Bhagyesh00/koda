import chokidar from 'chokidar';
import type { SSEWriter } from '../sse.js';
import { logger } from '../logger.js';

/** Live SSE connections registered per session id. */
const sessionConnections = new Map<string, Set<SSEWriter>>();

/** File watchers keyed by the watched path. */
const watchers = new Map<string, ReturnType<typeof chokidar.watch>>();

/** Track which sessions watch a given path. */
const pathToSessions = new Map<string, Set<string>>();

export function registerWatchConnection(sessionId: string, sse: SSEWriter): () => void {
  let conns = sessionConnections.get(sessionId);
  if (!conns) {
    conns = new Set();
    sessionConnections.set(sessionId, conns);
  }
  conns.add(sse);

  return () => {
    conns?.delete(sse);
    if (conns?.size === 0) {
      sessionConnections.delete(sessionId);
    }
  };
}

export function startWatchingPath(sessionId: string, watchPath: string): void {
  // Register session → path mapping
  let sessions = pathToSessions.get(watchPath);
  if (!sessions) {
    sessions = new Set();
    pathToSessions.set(watchPath, sessions);
  }
  sessions.add(sessionId);

  if (watchers.has(watchPath)) return; // already watching

  const watcher = chokidar.watch(watchPath, {
    ignored: [
      /(^|[/\\])\../,      // dotfiles
      '**/node_modules/**',
      '**/.git/**',
      '**/*.log',
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });

  function emit(files: string[], changeType: 'modified' | 'added' | 'deleted') {
    const affectedSessions = pathToSessions.get(watchPath);
    if (!affectedSessions) return;
    for (const sid of affectedSessions) {
      const conns = sessionConnections.get(sid);
      if (!conns) continue;
      for (const sse of conns) {
        if (!sse.isClosed) {
          sse.send({ type: 'workspace_change', files, changeType });
        }
      }
    }
  }

  watcher
    .on('change', (path) => emit([path], 'modified'))
    .on('add', (path) => emit([path], 'added'))
    .on('unlink', (path) => emit([path], 'deleted'))
    .on('error', (err) => logger.error({ err }, 'chokidar watcher error'));

  watchers.set(watchPath, watcher);
  logger.info({ watchPath }, 'started file watcher');
}

export async function stopWatchingPath(watchPath: string): Promise<void> {
  const watcher = watchers.get(watchPath);
  if (watcher) {
    await watcher.close();
    watchers.delete(watchPath);
    pathToSessions.delete(watchPath);
    logger.info({ watchPath }, 'stopped file watcher');
  }
}
