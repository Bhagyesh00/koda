import chokidar from 'chokidar';
import type { SSEWriter } from '../sse.js';
import { logger } from '../logger.js';

/** Live SSE connections registered per session id. */
const sessionConnections = new Map<string, Set<SSEWriter>>();

/** File watchers keyed by the watched path. */
const watchers = new Map<string, ReturnType<typeof chokidar.watch>>();

/** Track which sessions watch a given path. */
const pathToSessions = new Map<string, Set<string>>();

/** Reverse lookup so unregister can clean pathToSessions without scanning all paths. */
const sessionToPath = new Map<string, string>();

const DEBOUNCE_FLUSH_MS = 100;
const DEBOUNCE_MAX_BATCH = 200;

interface PendingBatch {
  modified: Set<string>;
  added: Set<string>;
  deleted: Set<string>;
  timer: NodeJS.Timeout | null;
}

const pendingBatches = new Map<string, PendingBatch>();

function getOrCreateBatch(watchPath: string): PendingBatch {
  let batch = pendingBatches.get(watchPath);
  if (!batch) {
    batch = { modified: new Set(), added: new Set(), deleted: new Set(), timer: null };
    pendingBatches.set(watchPath, batch);
  }
  return batch;
}

function flushBatch(watchPath: string): void {
  const batch = pendingBatches.get(watchPath);
  if (!batch) return;
  pendingBatches.delete(watchPath);
  if (batch.timer) clearTimeout(batch.timer);
  const affectedSessions = pathToSessions.get(watchPath);
  if (!affectedSessions || affectedSessions.size === 0) return;

  const send = (files: string[], changeType: 'modified' | 'added' | 'deleted') => {
    if (files.length === 0) return;
    for (const sid of affectedSessions) {
      const conns = sessionConnections.get(sid);
      if (!conns) continue;
      for (const sse of conns) {
        if (!sse.isClosed) sse.send({ type: 'workspace_change', files, changeType });
      }
    }
  };

  send(Array.from(batch.added), 'added');
  send(Array.from(batch.modified), 'modified');
  send(Array.from(batch.deleted), 'deleted');
}

function enqueue(watchPath: string, file: string, changeType: 'modified' | 'added' | 'deleted'): void {
  const batch = getOrCreateBatch(watchPath);
  // If a file is added then deleted in the same window, the deletion wins —
  // keep the bookkeeping simple by removing the file from prior buckets.
  if (changeType === 'deleted') {
    batch.added.delete(file);
    batch.modified.delete(file);
    batch.deleted.add(file);
  } else if (changeType === 'added') {
    batch.deleted.delete(file);
    batch.added.add(file);
  } else {
    if (!batch.added.has(file)) batch.modified.add(file);
  }

  const total = batch.added.size + batch.modified.size + batch.deleted.size;
  if (total >= DEBOUNCE_MAX_BATCH) {
    flushBatch(watchPath);
    return;
  }
  if (!batch.timer) {
    batch.timer = setTimeout(() => flushBatch(watchPath), DEBOUNCE_FLUSH_MS);
  }
}

export function registerWatchConnection(sessionId: string, sse: SSEWriter): () => void {
  let conns = sessionConnections.get(sessionId);
  if (!conns) {
    conns = new Set();
    sessionConnections.set(sessionId, conns);
  }
  conns.add(sse);

  return () => {
    const liveConns = sessionConnections.get(sessionId);
    if (!liveConns) return;
    liveConns.delete(sse);
    if (liveConns.size === 0) {
      sessionConnections.delete(sessionId);
      detachSessionFromPath(sessionId);
    }
  };
}

function detachSessionFromPath(sessionId: string): void {
  const watchPath = sessionToPath.get(sessionId);
  if (!watchPath) return;
  sessionToPath.delete(sessionId);
  const sessions = pathToSessions.get(watchPath);
  if (!sessions) return;
  sessions.delete(sessionId);
  if (sessions.size === 0) {
    pathToSessions.delete(watchPath);
    // Last subscriber for this path — close the underlying watcher to free FDs.
    void stopWatchingPath(watchPath);
  }
}

export function startWatchingPath(sessionId: string, watchPath: string): void {
  // Register session → path mapping (both directions for cheap cleanup).
  let sessions = pathToSessions.get(watchPath);
  if (!sessions) {
    sessions = new Set();
    pathToSessions.set(watchPath, sessions);
  }
  sessions.add(sessionId);
  sessionToPath.set(sessionId, watchPath);

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

  watcher
    .on('change', (file) => enqueue(watchPath, file, 'modified'))
    .on('add', (file) => enqueue(watchPath, file, 'added'))
    .on('unlink', (file) => enqueue(watchPath, file, 'deleted'))
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
    const batch = pendingBatches.get(watchPath);
    if (batch?.timer) clearTimeout(batch.timer);
    pendingBatches.delete(watchPath);
    logger.info({ watchPath }, 'stopped file watcher');
  }
}

/** Called by sessionStore.delete so a deleted session can't keep its watcher alive. */
export function stopWatchingForSession(sessionId: string): void {
  const conns = sessionConnections.get(sessionId);
  if (conns) {
    for (const sse of conns) sse.close();
    sessionConnections.delete(sessionId);
  }
  detachSessionFromPath(sessionId);
}
