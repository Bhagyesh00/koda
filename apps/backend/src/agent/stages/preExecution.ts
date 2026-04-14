import path from 'node:path';
import fs from 'node:fs';
import { sessionStore } from '../../sessions/store.js';
import { STAGE_KEYS, type ToolCallCtx } from './types.js';

/** Read-only tools that contribute to Context Lens tracking. */
const CONTEXT_TRACKING_TOOLS = new Set(['read_file', 'glob', 'grep', 'list_dir']);

/**
 * Context Lens tracking.
 * Records which files were accessed this session so the ContextLensPanel can
 * display them. Fires for read-only tools (read_file, glob, grep, list_dir).
 */
export function runContextLens(ctx: ToolCallCtx): void {
  const { sessionId, tool, finalArgs, sse } = ctx;
  if (!CONTEXT_TRACKING_TOOLS.has(tool.name)) return;
  const a = finalArgs as Record<string, unknown>;
  const tracked: string[] = [];
  if (typeof a.path === 'string') tracked.push(a.path);
  if (typeof a.pattern === 'string') tracked.push(`glob:${a.pattern}`);
  if (tracked.length) {
    sessionStore.addContextReads(sessionId, tracked);
    sse.send({ type: 'context_update', files: tracked });
  }
}

/**
 * Phase 30 — Mental model update.
 * Maintains a weighted file co-access graph so the MentalModelCanvas can
 * visualise which files the agent treats as related.
 */
export function runMentalModel(ctx: ToolCallCtx): void {
  const { sessionId, tool, finalArgs, sse } = ctx;
  if (
    tool.name !== 'read_file' &&
    tool.name !== 'write_file' &&
    tool.name !== 'edit_file'
  ) {
    return;
  }
  const filePath = (finalArgs as { path?: string }).path;
  if (!filePath) return;

  sessionStore.updateMentalModel(sessionId, (model) => {
    const existing = model.nodes.find((n) => n.id === filePath);
    if (existing) {
      existing.weight += 1;
    } else {
      model.nodes.push({
        id: filePath,
        kind: 'file',
        label: filePath.split(/[\\/]/).pop() ?? filePath,
        weight: 1,
      });
    }
    // Add co-access edges to all other nodes in the graph
    for (const other of model.nodes) {
      if (other.id === filePath) continue;
      const edgeExists = model.edges.some(
        (e) =>
          (e.from === filePath && e.to === other.id) ||
          (e.from === other.id && e.to === filePath),
      );
      if (!edgeExists && other.weight >= 1) {
        model.edges.push({ from: filePath, to: other.id, kind: 'co-accessed' });
      }
    }
    // Cap the graph size — evict lowest-weight nodes
    if (model.nodes.length > 50) {
      const sorted = [...model.nodes].sort((a, b) => b.weight - a.weight);
      const keep = new Set(sorted.slice(0, 50).map((n) => n.id));
      model.nodes = model.nodes.filter((n) => keep.has(n.id));
      model.edges = model.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
    }
  });

  const s = sessionStore.get(sessionId);
  if (s?.mentalModel) {
    sse.send({
      type: 'mental_model_update',
      nodes: s.mentalModel.nodes,
      edges: s.mentalModel.edges,
    });
  }
}

/**
 * Phase 25 — Semantic diff: capture "before" snapshot.
 * Must be called BEFORE tool execution.  The captured content is stashed in
 * ctx.stageState under STAGE_KEYS.SEMANTIC_DIFF_BEFORE so that
 * runSemanticDiffCompare() (post-execution) can compute the diff.
 */
export function captureSemanticBefore(ctx: ToolCallCtx): void {
  const { workDir, tool, finalArgs, stageState } = ctx;
  if (tool.name !== 'write_file' && tool.name !== 'edit_file') return;
  const targetPath = (finalArgs as { path?: string }).path;
  if (!targetPath) return;
  const abs = path.isAbsolute(targetPath)
    ? targetPath
    : path.join(workDir, targetPath);
  let before = '';
  try {
    before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
  } catch {
    /* file may not exist yet — treat as empty */
  }
  stageState.set(STAGE_KEYS.SEMANTIC_DIFF_BEFORE, { before, targetPath });
}
