import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import logger from '../config/logger.js';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  // Log error with request context
  logger.error(err.message, {
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userId: (req.user as { id?: number })?.id,
    body: req.method !== 'GET' ? req.body : undefined,
  });

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      message: err.message,
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      message: 'Validation error',
      errors: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  if (err.name === 'MulterError') {
    const multerMessages: Record<string, string> = {
      LIMIT_FILE_SIZE: 'File is too large. Maximum size is 10MB.',
      LIMIT_FILE_COUNT: 'Too many files. Please upload one file at a time.',
      LIMIT_UNEXPECTED_FILE: 'Unexpected file field. Please try again.',
    };
    return res.status(400).json({
      message: multerMessages[(err as unknown as { code: string }).code] || err.message,
    });
  }

  // Default error
  res.status(500).json({
    message: 'Internal server error',
  });
};

export const notFoundHandler = (_req: Request, res: Response) => {
  res.status(404).json({
    message: 'Resource not found',
  });
};
