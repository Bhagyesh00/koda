import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query, isPoolAvailable } from '../db/client.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export const authRouter: Router = Router();

const JWT_SECRET = config.JWT_SECRET;
const TOKEN_TTL = '7d';

function generateToken(userId: string, email: string, role: string): string {
  return jwt.sign({ sub: userId, email, role }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

// POST /v1/auth/register
authRouter.post('/auth/register', async (req, res) => {
  if (!isPoolAvailable()) {
    res.status(503).json({ error: 'Multi-user auth requires DATABASE_URL to be configured' });
    return;
  }
  const { email, password, adminToken } = req.body as {
    email?: string;
    password?: string;
    adminToken?: string;
  };

  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'password must be at least 8 characters' });
    return;
  }

  // First user auto-becomes admin; subsequent registrations require admin token
  const { rows: existing } = await query<{ count: string }>('SELECT COUNT(*) AS count FROM users');
  const userCount = parseInt(existing[0]?.count ?? '0', 10);

  if (userCount > 0) {
    if (adminToken !== config.AUTH_TOKEN) {
      res.status(403).json({ error: 'Admin token required to register additional users' });
      return;
    }
  }

  const { rows: dup } = await query('SELECT id FROM users WHERE email=$1', [email]);
  if (dup.length > 0) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  const role = userCount === 0 ? 'admin' : 'user';
  const { rows } = await query<{ id: string }>(
    'INSERT INTO users (email, password_hash, role) VALUES ($1,$2,$3) RETURNING id',
    [email, hash, role],
  );
  const userId = rows[0]!.id;
  const token = generateToken(userId, email, role);
  logger.info({ userId, email, role }, 'user registered');
  res.status(201).json({ token, userId, email, role });
});

// POST /v1/auth/login
authRouter.post('/auth/login', async (req, res) => {
  if (!isPoolAvailable()) {
    res.status(503).json({ error: 'Multi-user auth requires DATABASE_URL to be configured' });
    return;
  }
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  const { rows } = await query<{ id: string; password_hash: string; role: string }>(
    'SELECT id, password_hash, role FROM users WHERE email=$1',
    [email],
  );
  const user = rows[0];
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = generateToken(user.id, email, user.role);
  logger.info({ userId: user.id, email }, 'user logged in');
  res.json({ token, userId: user.id, email, role: user.role });
});

// GET /v1/auth/me
authRouter.get('/auth/me', (req, res) => {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'No token' });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; email: string; role: string };
    res.json({ userId: payload.sub, email: payload.email, role: payload.role });
  } catch {
    // Legacy single-token auth
    if (token === config.AUTH_TOKEN) {
      res.json({ userId: 'system', email: 'system', role: 'admin' });
      return;
    }
    res.status(401).json({ error: 'Invalid token' });
  }
});
