import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { AppError } from './errorHandler.js';
const generateFilename = (file) => {
    const uniqueSuffix = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname) || '';
    return `${Date.now()}-${uniqueSuffix}${ext}`;
};
// Default storage
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        const destPath = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(destPath))
            fs.mkdirSync(destPath, { recursive: true });
        cb(null, destPath);
    },
    filename: (_req, file, cb) => {
        cb(null, generateFilename(file));
    },
});
const fileFilter = (_req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    }
    else {
        cb(new AppError(`Unsupported file type: ${file.mimetype}`, 400));
    }
};
export const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 },
});
