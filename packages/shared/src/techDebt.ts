import { z } from 'zod';

/**
 * Phase 5 — Autonomous Tech Debt Scanner.
 *
 * A "Finding" is a single piece of suggested cleanup the scanner has surfaced.
 * The scanner never auto-applies — findings sit in a queue with a status; the
 * user dismisses, accepts (marks fixed), or asks the agent to address one.
 */

export const FindingCategorySchema = z.enum([
  'large_file',
  'todo_marker',
  'vulnerability',
  'duplication',
]);
export type FindingCategory = z.infer<typeof FindingCategorySchema>;

export const FindingSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const FindingStatusSchema = z.enum(['open', 'dismissed', 'fixed']);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const FindingSchema = z.object({
  id: z.string(),
  /** Groups findings produced by a single scan run so trending/history works. */
  scanId: z.string(),
  workDir: z.string(),
  ts: z.number(),
  category: FindingCategorySchema,
  severity: FindingSeveritySchema,
  /** Workspace-relative path the finding refers to (omitted for repo-level findings). */
  filePath: z.string().optional(),
  line: z.number().int().positive().optional(),
  description: z.string().min(1),
  /** Optional human-readable suggestion the user can hand to the agent. */
  suggestion: z.string().optional(),
  status: FindingStatusSchema.default('open'),
  /** Free-form metadata per category (e.g. duplication group id, CVE list). */
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const ScanSummarySchema = z.object({
  scanId: z.string(),
  ts: z.number(),
  workDir: z.string(),
  durationMs: z.number().int().min(0),
  totalFindings: z.number().int().min(0),
  bySeverity: z.record(FindingSeveritySchema, z.number().int().min(0)),
  byCategory: z.record(FindingCategorySchema, z.number().int().min(0)),
});
export type ScanSummary = z.infer<typeof ScanSummarySchema>;
