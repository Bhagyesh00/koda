import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { logger } from '../logger.js';

const uploadsDir = path.join(config.WORK_DIR_ABS, '.koda', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    // Allow common file types
    const allowed = /\.(txt|md|pdf|png|jpg|jpeg|gif|webp|svg|json|csv|ts|js|py|rs|go|java|c|cpp|h|yml|yaml|toml|xml|html|css|mp4|webm|mov|mp3|wav)$/i;
    if (allowed.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.originalname}`));
    }
  },
});

export const uploadRouter: Router = Router();

uploadRouter.post('/upload', upload.array('files', 20), (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }

  const result = files.map((f) => ({
    originalName: f.originalname,
    savedName: f.filename,
    path: f.path,
    size: f.size,
    mimeType: f.mimetype,
  }));

  logger.info({ count: files.length }, 'files uploaded');
  res.json({ files: result });
});

// Multer error → 400
uploadRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : 'Upload error';
  res.status(400).json({ error: msg });
});

// Serve uploaded files
uploadRouter.get('/uploads/:filename', (req, res) => {
  const filename = path.basename(req.params.filename ?? '');
  const filePath = path.join(uploadsDir, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  res.sendFile(filePath);
});
