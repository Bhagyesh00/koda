import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';

const auditDir = path.join(config.WORK_DIR_ABS, '..', '.koda');
const auditFile = path.join(auditDir, 'audit.log');

try {
  fs.mkdirSync(auditDir, { recursive: true });
} catch (err) {
  logger.warn({ err }, 'could not create audit dir');
}

export interface AuditEntry {
  sessionId: string;
  tool: string;
  callId: string;
  ok: boolean;
  ts: number;
}

export function auditLog(entry: AuditEntry): void {
  try {
    fs.appendFileSync(auditFile, JSON.stringify(entry) + '\n');
  } catch (err) {
    logger.warn({ err }, 'audit log write failed');
  }
}
