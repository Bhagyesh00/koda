import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { Finding, FindingSeverity } from '@koda/shared';
import { runShell } from '../sandbox/exec.js';
import { logger } from '../logger.js';

/**
 * Phase 5 — Tech Debt Scanner.
 *
 * Pure-code analysis with NO LLM dependency. Returns Finding[] without
 * persisting; the caller writes them to the store. Each scanner is independent
 * so a single failure doesn't poison the batch.
 *
 * Scanners implemented:
 *   - large_file     files exceeding LARGE_FILE_LINES
 *   - todo_marker    TODO / FIXME / HACK / XXX comments in tracked code
 *   - vulnerability  npm/pnpm/yarn audit JSON parse
 *   - duplication    files whose first ~20 non-empty lines hash to the same value
 *
 * Adding a new scanner: write an async function returning Finding[], then
 * include it in the runScan Promise.allSettled list. Failures are logged but
 * not propagated.
 */

const LARGE_FILE_LINES = 800;
const LARGE_FILE_LINES_CRITICAL = 2_000;
const TODO_REGEX = /\b(TODO|FIXME|HACK|XXX)\b[: ]?\s*(.{0,140})/i;
const DUP_HASH_LINES = 20;
const CODE_EXT_REGEX = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|c|cc|cpp|h|hpp)$/i;

function newFinding(scanId: string, workDir: string, partial: Omit<Finding, 'id' | 'scanId' | 'workDir' | 'ts' | 'status'>): Finding {
  return {
    id: nanoid(12),
    scanId,
    workDir,
    ts: Date.now(),
    status: 'open',
    ...partial,
  };
}

async function listTrackedFiles(workDir: string, signal?: AbortSignal): Promise<string[]> {
  const r = await runShell('git ls-files', { cwd: workDir, signal });
  if (r.exitCode !== 0) return [];
  return r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function readFileSafe(p: string): string | null {
  try {
    const stat = fs.statSync(p);
    if (!stat.isFile()) return null;
    if (stat.size > 5_000_000) return null; // skip files > 5 MB
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

// ── Large files ──────────────────────────────────────────────────────────────

export async function scanLargeFiles(
  workDir: string,
  files: string[],
  scanId: string,
): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const rel of files) {
    if (!CODE_EXT_REGEX.test(rel)) continue;
    const abs = path.join(workDir, rel);
    const content = readFileSafe(abs);
    if (!content) continue;
    const lines = content.split('\n').length;
    if (lines < LARGE_FILE_LINES) continue;
    const severity: FindingSeverity = lines >= LARGE_FILE_LINES_CRITICAL ? 'high' : 'medium';
    out.push(
      newFinding(scanId, workDir, {
        category: 'large_file',
        severity,
        filePath: rel,
        description: `${rel} is ${lines} lines (threshold ${LARGE_FILE_LINES}).`,
        suggestion: `Consider splitting ${rel} into smaller modules with single responsibilities.`,
        meta: { lineCount: lines, threshold: LARGE_FILE_LINES },
      }),
    );
  }
  return out;
}

// ── TODO / FIXME / HACK / XXX markers ────────────────────────────────────────

export async function scanTodoMarkers(
  workDir: string,
  files: string[],
  scanId: string,
): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const rel of files) {
    if (!CODE_EXT_REGEX.test(rel)) continue;
    const abs = path.join(workDir, rel);
    const content = readFileSafe(abs);
    if (!content) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i]!.match(TODO_REGEX);
      if (!m) continue;
      const marker = m[1]!.toUpperCase();
      // FIXME/HACK/XXX are higher signal than TODO — bump severity.
      const severity: FindingSeverity =
        marker === 'FIXME' || marker === 'HACK' || marker === 'XXX' ? 'medium' : 'low';
      out.push(
        newFinding(scanId, workDir, {
          category: 'todo_marker',
          severity,
          filePath: rel,
          line: i + 1,
          description: `${marker} at ${rel}:${i + 1} — ${(m[2] ?? '').trim() || '(no annotation)'}`,
          suggestion: `Resolve or convert this ${marker} into a tracked issue.`,
          meta: { marker },
        }),
      );
    }
  }
  return out;
}

// ── Dependency vulnerabilities ───────────────────────────────────────────────

interface NpmAuditAdvisory {
  name?: string;
  severity?: string;
  via?: Array<string | { title?: string; severity?: string; url?: string }>;
}

function severityFromAudit(s: string | undefined): FindingSeverity {
  switch ((s ?? '').toLowerCase()) {
    case 'critical': return 'critical';
    case 'high': return 'high';
    case 'moderate':
    case 'medium': return 'medium';
    default: return 'low';
  }
}

export async function scanVulnerabilities(
  workDir: string,
  scanId: string,
  signal?: AbortSignal,
): Promise<Finding[]> {
  // Pick the first lockfile we recognise.
  const candidates: Array<{ file: string; cmd: string }> = [
    { file: 'pnpm-lock.yaml', cmd: 'pnpm audit --json' },
    { file: 'package-lock.json', cmd: 'npm audit --json' },
    { file: 'yarn.lock', cmd: 'yarn audit --json' },
  ];
  const detected = candidates.find((c) => fs.existsSync(path.join(workDir, c.file)));
  if (!detected) return [];

  const r = await runShell(detected.cmd, { cwd: workDir, signal, timeoutMs: 60_000 });
  // npm audit prints to stdout; non-zero exit when issues exist is normal.
  const raw = r.stdout || r.stderr;
  if (!raw.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const out: Finding[] = [];
  // npm v7+ shape
  const advisories = (parsed as { vulnerabilities?: Record<string, NpmAuditAdvisory> }).vulnerabilities;
  if (advisories && typeof advisories === 'object') {
    for (const [name, adv] of Object.entries(advisories)) {
      const severity = severityFromAudit(adv.severity);
      const viaTitles = (adv.via ?? [])
        .map((v) => (typeof v === 'string' ? v : v.title))
        .filter(Boolean) as string[];
      out.push(
        newFinding(scanId, workDir, {
          category: 'vulnerability',
          severity,
          description: `Vulnerability in ${name}: ${viaTitles.join('; ') || (adv.severity ?? 'unknown')}`,
          suggestion: `Run \`${detected.cmd.replace('--json', '--fix')}\` or upgrade ${name} manually.`,
          meta: { package: name, raw: adv },
        }),
      );
    }
  }
  return out;
}

// ── Duplication detection ────────────────────────────────────────────────────

/**
 * Cheap heuristic: hash the first DUP_HASH_LINES non-empty/non-comment lines
 * of each code file; flag any group of 2+ files that share the same hash.
 *
 * Misses partial duplicates and intentional copies; catches obvious "copy a
 * file and rename it" cases which are the bulk of real-world duplication.
 */
export async function scanDuplication(
  workDir: string,
  files: string[],
  scanId: string,
): Promise<Finding[]> {
  const groups = new Map<string, string[]>();
  for (const rel of files) {
    if (!CODE_EXT_REGEX.test(rel)) continue;
    const abs = path.join(workDir, rel);
    const content = readFileSafe(abs);
    if (!content) continue;
    const meaningful = content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('#'))
      .slice(0, DUP_HASH_LINES);
    if (meaningful.length < DUP_HASH_LINES) continue;
    const hash = meaningful.join('\n');
    let bucket = groups.get(hash);
    if (!bucket) {
      bucket = [];
      groups.set(hash, bucket);
    }
    bucket.push(rel);
  }
  const out: Finding[] = [];
  for (const [hash, paths] of groups) {
    if (paths.length < 2) continue;
    const groupId = nanoid(8);
    for (const rel of paths) {
      out.push(
        newFinding(scanId, workDir, {
          category: 'duplication',
          severity: 'medium',
          filePath: rel,
          description: `${rel} starts identically to ${paths.length - 1} other file${paths.length === 2 ? '' : 's'} (${paths.filter((p) => p !== rel).slice(0, 3).join(', ')}${paths.length > 4 ? '…' : ''}).`,
          suggestion: `Extract the shared prefix into a single module.`,
          meta: { groupId, peers: paths.filter((p) => p !== rel), hashPrefix: hash.slice(0, 80) },
        }),
      );
    }
  }
  return out;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export interface RunScanResult {
  scanId: string;
  durationMs: number;
  findings: Finding[];
  errors: string[];
}

export async function runScan(workDir: string, signal?: AbortSignal): Promise<RunScanResult> {
  const scanId = nanoid(10);
  const startedAt = Date.now();
  const errors: string[] = [];

  const files = await listTrackedFiles(workDir, signal).catch((err) => {
    errors.push(`listTrackedFiles failed: ${err instanceof Error ? err.message : String(err)}`);
    return [] as string[];
  });

  const settled = await Promise.allSettled([
    scanLargeFiles(workDir, files, scanId),
    scanTodoMarkers(workDir, files, scanId),
    scanVulnerabilities(workDir, scanId, signal),
    scanDuplication(workDir, files, scanId),
  ]);

  const findings: Finding[] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') findings.push(...s.value);
    else errors.push(s.reason instanceof Error ? s.reason.message : String(s.reason));
  }

  const durationMs = Date.now() - startedAt;
  // Stamp the duration into each finding's meta so summarise() can surface it.
  for (const f of findings) {
    f.meta = { ...(f.meta ?? {}), scanDurationMs: durationMs };
  }

  logger.info(
    { scanId, durationMs, totalFindings: findings.length, errors: errors.length },
    'tech-debt scan complete',
  );
  return { scanId, durationMs, findings, errors };
}
