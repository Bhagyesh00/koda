const registry = new Map<string, AbortController>();

export function registerTurn(sessionId: string, ac: AbortController): void {
  registry.set(sessionId, ac);
}

export function cancelTurn(sessionId: string): boolean {
  const ac = registry.get(sessionId);
  if (!ac) return false;
  ac.abort();
  registry.delete(sessionId);
  return true;
}

export function unregisterTurn(sessionId: string): void {
  registry.delete(sessionId);
}

export function isTurnRunning(sessionId: string): boolean {
  return registry.has(sessionId);
}
