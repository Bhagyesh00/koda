import { Router } from 'express';
import { z } from 'zod';
import { usageTracker } from '../usage/tracker.js';

export const usageRouter: Router = Router();

const QueryParams = z.object({
  from: z.coerce.number().optional(),
  to: z.coerce.number().optional(),
  period: z.enum(['today', 'week', 'month', 'year', 'all', 'custom']).optional().default('today'),
});

function getPeriodRange(period: string, from?: number, to?: number): { from: number; to: number } {
  const now = Date.now();
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

  switch (period) {
    case 'today':
      return { from: startOfDay.getTime(), to: now };
    case 'week': {
      const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0);
      return { from: d.getTime(), to: now };
    }
    case 'month': {
      const d = new Date(); d.setDate(d.getDate() - 30); d.setHours(0, 0, 0, 0);
      return { from: d.getTime(), to: now };
    }
    case 'year': {
      const d = new Date(); d.setFullYear(d.getFullYear() - 1); d.setHours(0, 0, 0, 0);
      return { from: d.getTime(), to: now };
    }
    case 'custom':
      return { from: from ?? 0, to: to ?? now };
    case 'all':
    default:
      return { from: 0, to: now };
  }
}

usageRouter.get('/usage', (req, res) => {
  const { period, from, to } = QueryParams.parse(req.query);
  const range = getPeriodRange(period, from, to);
  const stats = usageTracker.aggregate(range.from, range.to);
  res.json({
    period,
    from: range.from,
    to: range.to,
    ...stats,
  });
});

// Summary endpoint: returns quick stats for all common periods
usageRouter.get('/usage/summary', (_req, res) => {
  const now = Date.now();
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7); weekAgo.setHours(0, 0, 0, 0);
  const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30); monthAgo.setHours(0, 0, 0, 0);

  res.json({
    today: usageTracker.aggregate(startOfDay.getTime(), now),
    week: usageTracker.aggregate(weekAgo.getTime(), now),
    month: usageTracker.aggregate(monthAgo.getTime(), now),
    allTime: usageTracker.aggregate(0, now),
  });
});
