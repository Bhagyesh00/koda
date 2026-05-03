import { Router } from 'express';
import { z } from 'zod';
import { FindingStatusSchema } from '@koda/shared';
import { techDebtStore } from '../techDebt/store.js';
import { runScan } from '../techDebt/scanner.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export const techDebtRouter: Router = Router();

const ListQuery = z.object({
  status: FindingStatusSchema.optional(),
  scanId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

// GET /v1/tech-debt — list findings
techDebtRouter.get('/tech-debt', (req, res) => {
  const { status, scanId, limit } = ListQuery.parse(req.query);
  const findings = techDebtStore.list({ status, scanId, limit });
  res.json({ total: findings.length, findings });
});

// GET /v1/tech-debt/summary — aggregated stats for a scan or the whole store
techDebtRouter.get('/tech-debt/summary', (req, res) => {
  const scanId = typeof req.query.scanId === 'string' ? req.query.scanId : undefined;
  res.json(techDebtStore.summarise(scanId));
});

// GET /v1/tech-debt/:id
techDebtRouter.get('/tech-debt/:id', (req, res) => {
  const finding = techDebtStore.get(req.params.id ?? '');
  if (!finding) {
    res.status(404).json({ error: 'finding not found' });
    return;
  }
  res.json(finding);
});

// POST /v1/tech-debt/scan — trigger a scan now. Returns the scanId; the scan
// runs in the background so the request returns immediately.
const ScanBody = z.object({
  workDir: z.string().optional(),
});
techDebtRouter.post('/tech-debt/scan', async (req, res) => {
  const { workDir } = ScanBody.parse(req.body ?? {});
  const target = workDir ?? config.WORK_DIR_ABS;
  // Fire-and-forget; the response carries the scanId so the client can poll.
  // We still await the runScan synchronously here so list() reflects the new
  // findings on next GET — at the cost of a slow request. For a true
  // background scan, add `?async=true` and return early before runScan resolves.
  const result = await runScan(target);
  await techDebtStore.insertBatch(result.findings);
  res.status(201).json({
    scanId: result.scanId,
    durationMs: result.durationMs,
    findings: result.findings.length,
    errors: result.errors,
  });
});

const StatusBody = z.object({ status: FindingStatusSchema });

// PATCH /v1/tech-debt/:id — update status (open / dismissed / fixed)
techDebtRouter.patch('/tech-debt/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: 'id required' });
    return;
  }
  const body = StatusBody.parse(req.body);
  const updated = await techDebtStore.setStatus(id, body.status);
  if (!updated) {
    // Express 4 doesn't auto-forward async throws — respond explicitly so the
    // request actually finishes and supertest doesn't time out.
    res.status(404).json({ error: 'finding not found' });
    return;
  }
  res.json(updated);
});

/**
 * Optional auto-scan loop. Enabled only when `TECH_DEBT_SCAN_INTERVAL_MS` is
 * a positive integer in env. Default behavior (env unset or 0) is no
 * background scanning — the user has to POST /v1/tech-debt/scan manually or
 * configure their own cron.
 */
let autoScanTimer: NodeJS.Timeout | null = null;
export function startAutoScanLoop(): void {
  if (autoScanTimer) return;
  const interval = config.TECH_DEBT_SCAN_INTERVAL_MS;
  if (!interval || interval <= 0) return;
  logger.info({ interval }, 'tech-debt auto-scan loop starting');
  autoScanTimer = setInterval(async () => {
    try {
      const result = await runScan(config.WORK_DIR_ABS);
      await techDebtStore.insertBatch(result.findings);
      logger.info(
        { scanId: result.scanId, findings: result.findings.length },
        'auto-scan run complete',
      );
    } catch (err) {
      logger.error({ err }, 'auto-scan run failed');
    }
  }, interval);
  // Don't keep the Node process alive solely for scans.
  autoScanTimer.unref?.();
}

export function stopAutoScanLoop(): void {
  if (autoScanTimer) {
    clearInterval(autoScanTimer);
    autoScanTimer = null;
  }
}
