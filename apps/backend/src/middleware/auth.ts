import type { RequestHandler } from 'express';
import { config } from '../config.js';

export const requireAuth: RequestHandler = (req, res, next) => {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== config.AUTH_TOKEN) {
    res.status(401).json({ code: 'unauthorized', message: 'Invalid or missing token' });
    return;
  }
  next();
};
