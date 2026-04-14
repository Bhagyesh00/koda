import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { NotFoundError } from '../errors.js';
import {
  CustomToolDefSchema,
  listCustomToolDefs,
  saveCustomTool,
  deleteCustomToolFile,
  registerCustomTool,
} from '../tools/customLoader.js';

export const customToolsRouter: RouterType = Router();

customToolsRouter.get('/custom-tools', (_req, res) => {
  const tools = listCustomToolDefs(config.WORK_DIR_ABS);
  res.json({ tools });
});

customToolsRouter.post('/custom-tools', (req, res) => {
  const def = CustomToolDefSchema.parse(req.body ?? {});
  saveCustomTool(config.WORK_DIR_ABS, def);
  registerCustomTool(def);
  res.status(201).json(def);
});

customToolsRouter.put('/custom-tools/:name', (req, res) => {
  const existing = listCustomToolDefs(config.WORK_DIR_ABS).find(
    (t) => t.name === req.params.name,
  );
  if (!existing) throw new NotFoundError('custom tool');
  const def = CustomToolDefSchema.parse({ ...req.body, name: req.params.name });
  saveCustomTool(config.WORK_DIR_ABS, def);
  registerCustomTool(def);
  res.json(def);
});

customToolsRouter.delete('/custom-tools/:name', (req, res) => {
  const existing = listCustomToolDefs(config.WORK_DIR_ABS).find(
    (t) => t.name === req.params.name,
  );
  if (!existing) throw new NotFoundError('custom tool');
  deleteCustomToolFile(config.WORK_DIR_ABS, req.params.name!);
  res.status(204).end();
});
