import { Router } from 'express';
import type { Router as RouterType } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { ValidationError } from '../errors.js';
import { config } from '../config.js';

export const fsRouter: RouterType = Router();

const ListQuery = z.object({
  path: z.string().optional(),
  showHidden: z.enum(['0', '1']).optional().default('0'),
});

const MAX_ENTRIES = 500;

fsRouter.get('/fs/list', (req, res) => {
  const { path: queryPath, showHidden } = ListQuery.parse(req.query);
  const target = queryPath?.trim() || os.homedir();

  if (!path.isAbsolute(target)) {
    throw new ValidationError(`path must be absolute (got: ${target})`);
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    res.status(404).json({ error: `path does not exist: ${target}` });
    return;
  }
  if (!stat.isDirectory()) {
    res.status(400).json({ error: `path is not a directory: ${target}` });
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch (err) {
    res.status(403).json({ error: `cannot read directory: ${(err as Error).message}` });
    return;
  }

  const dirs = entries
    .filter((e) => e.isDirectory())
    .filter((e) => showHidden === '1' || !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, path: path.join(target, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_ENTRIES);

  const parsed = path.parse(target);
  const isRoot = target === parsed.root;
  const parent = isRoot ? null : path.dirname(target);

  res.json({
    cwd: target,
    parent,
    isRoot,
    entries: dirs,
    home: os.homedir(),
    workDir: config.WORK_DIR_ABS,
    truncated: dirs.length === MAX_ENTRIES,
  });
});

const ReadQuery = z.object({
  /** Absolute path to the file to read. */
  path: z.string().min(1),
});

const MAX_READ_BYTES = 200_000; // 200 KB hard cap for @mentions

fsRouter.get('/fs/read', (req, res) => {
  const { path: filePath } = ReadQuery.parse(req.query);

  if (!path.isAbsolute(filePath)) {
    throw new ValidationError(`path must be absolute (got: ${filePath})`);
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.status(404).json({ error: `file not found: ${filePath}` });
    return;
  }

  if (!stat.isFile()) {
    res.status(400).json({ error: `path is not a file: ${filePath}` });
    return;
  }

  if (stat.size > MAX_READ_BYTES) {
    res.status(413).json({ error: `file too large to attach (${stat.size} bytes, max ${MAX_READ_BYTES})` });
    return;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ path: filePath, content, size: stat.size });
  } catch (err) {
    res.status(403).json({ error: `cannot read file: ${(err as Error).message}` });
  }
});
