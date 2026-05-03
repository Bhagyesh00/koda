import fs from 'node:fs';
import path from 'node:path';
import type { Finding, FindingStatus, ScanSummary, FindingSeverity, FindingCategory } from '@koda/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { getPool, query } from '../db/client.js';

/**
 * Phase 5 — Tech Debt Findings store.
 *
 * Same dual-mode pattern as the session store: Postgres when DATABASE_URL is
 * set, JSON sidecar otherwise. Findings are append-mostly (status updates are
 * the only mutation) so the storage layer is intentionally minimal.
 */

const FINDINGS_FILE = path.join(config.WORK_DIR_ABS, '.koda', 'tech-debt-findings.json');

type Row = {
  id: string;
  scan_id: string;
  work_dir: string;
  ts: string | number;
  category: FindingCategory;
  severity: FindingSeverity;
  file_path: string | null;
  line: number | null;
  description: string;
  suggestion: string | null;
  status: FindingStatus;
  meta: Record<string, unknown> | null;
};

function rowToFinding(r: Row): Finding {
  return {
    id: r.id,
    scanId: r.scan_id,
    workDir: r.work_dir,
    ts: typeof r.ts === 'string' ? Number(r.ts) : r.ts,
    category: r.category,
    severity: r.severity,
    filePath: r.file_path ?? undefined,
    line: r.line ?? undefined,
    description: r.description,
    suggestion: r.suggestion ?? undefined,
    status: r.status,
    meta: r.meta ?? undefined,
  };
}

class TechDebtStore {
  private memory: Finding[] = [];
  private loaded = false;

  async initialize(): Promise<void> {
    if (this.loaded) return;
    if (getPool()) {
      const { rows } = await query<Row>('SELECT * FROM tech_debt_findings ORDER BY ts DESC');
      this.memory = rows.map(rowToFinding);
      logger.info({ count: this.memory.length }, 'tech-debt findings loaded from postgres');
    } else {
      try {
        if (fs.existsSync(FINDINGS_FILE)) {
          const data = JSON.parse(fs.readFileSync(FINDINGS_FILE, 'utf8')) as Finding[];
          if (Array.isArray(data)) this.memory = data;
        }
      } catch (err) {
        logger.warn({ err }, 'failed to load tech-debt findings from file');
      }
    }
    this.loaded = true;
  }

  /** Replace the entire findings list — used in tests. Not exposed via API. */
  _resetForTests(): void {
    this.memory = [];
    if (!getPool()) {
      try { fs.unlinkSync(FINDINGS_FILE); } catch { /* ignore */ }
    }
  }

  list(opts: { status?: FindingStatus; scanId?: string; limit?: number } = {}): Finding[] {
    let out = this.memory;
    if (opts.status) out = out.filter((f) => f.status === opts.status);
    if (opts.scanId) out = out.filter((f) => f.scanId === opts.scanId);
    out = [...out].sort((a, b) => b.ts - a.ts);
    if (opts.limit) out = out.slice(0, opts.limit);
    return out;
  }

  get(id: string): Finding | undefined {
    return this.memory.find((f) => f.id === id);
  }

  /**
   * Insert a batch of findings from a single scan run. Older findings are not
   * deduplicated against new ones — the user can dismiss outdated entries.
   */
  async insertBatch(findings: Finding[]): Promise<void> {
    if (findings.length === 0) return;
    this.memory.unshift(...findings);
    if (getPool()) {
      for (const f of findings) {
        await query(
          `INSERT INTO tech_debt_findings
           (id, scan_id, work_dir, ts, category, severity, file_path, line, description, suggestion, status, meta)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            f.id, f.scanId, f.workDir, f.ts, f.category, f.severity,
            f.filePath ?? null, f.line ?? null, f.description, f.suggestion ?? null,
            f.status, f.meta ? JSON.stringify(f.meta) : null,
          ],
        ).catch((err) => logger.error({ err, id: f.id }, 'failed to insert finding'));
      }
    } else {
      this.persistFile();
    }
  }

  async setStatus(id: string, status: FindingStatus): Promise<Finding | undefined> {
    const f = this.memory.find((x) => x.id === id);
    if (!f) return undefined;
    f.status = status;
    if (getPool()) {
      await query('UPDATE tech_debt_findings SET status=$1 WHERE id=$2', [status, id])
        .catch((err) => logger.error({ err, id }, 'failed to update finding status'));
    } else {
      this.persistFile();
    }
    return f;
  }

  /** Aggregated summary for a single scan or the whole store. */
  summarise(scanId?: string): ScanSummary {
    const items = scanId ? this.memory.filter((f) => f.scanId === scanId) : this.memory;
    const bySeverity: Record<FindingSeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    const byCategory: Record<FindingCategory, number> = { large_file: 0, todo_marker: 0, vulnerability: 0, duplication: 0 };
    let durationMs = 0;
    let workDir = '';
    let ts = 0;
    for (const f of items) {
      bySeverity[f.severity]++;
      byCategory[f.category]++;
      if (f.ts > ts) ts = f.ts;
      workDir = f.workDir || workDir;
      // durationMs is per-scan in meta — pull from any finding that carries it.
      const dm = (f.meta as { scanDurationMs?: number } | undefined)?.scanDurationMs;
      if (typeof dm === 'number' && dm > durationMs) durationMs = dm;
    }
    return {
      scanId: scanId ?? 'all',
      ts,
      workDir,
      durationMs,
      totalFindings: items.length,
      bySeverity,
      byCategory,
    };
  }

  private persistFile(): void {
    try {
      fs.mkdirSync(path.dirname(FINDINGS_FILE), { recursive: true });
      const tmp = `${FINDINGS_FILE}.tmp.${process.pid}.${Date.now()}`;
      fs.writeFileSync(tmp, JSON.stringify(this.memory, null, 2));
      fs.renameSync(tmp, FINDINGS_FILE);
    } catch (err) {
      logger.error({ err }, 'failed to persist tech-debt findings');
    }
  }
}

export const techDebtStore = new TechDebtStore();
