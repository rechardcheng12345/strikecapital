import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Request } from 'express';
import crypto from 'crypto';
import { AppError } from './errorHandler.js';

const generateFilename = (file: Express.Multer.File): string => {
  const uniqueSuffix = crypto.randomBytes(16).toString('hex');
  const ext = path.extname(file.originalname) || '';
  return `${Date.now()}-${uniqueSuffix}${ext}`;
};

// Default storage
const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb) => {
    const destPath = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(destPath)) fs.mkdirSync(destPath, { recursive: true });
    cb(null, destPath);
  },
  filename: (_req: Request, file: Express.Multer.File, cb) => {
    cb(null, generateFilename(file));
  },
});

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError(`Unsupported file type: ${file.mimetype}`, 400) as unknown as Error);
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});
