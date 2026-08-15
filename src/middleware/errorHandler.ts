import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { isDev } from '../config/env.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('ErrorHandler');

// ─── AppError ──────────────────────────────────────────────────────────────────

/**
 * Custom operational error with an HTTP status code and an optional
 * machine-readable `code` string for the frontend to branch on.
 *
 * Throw this from anywhere — the global handler will catch it
 * and respond with a structured JSON body.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly status: 'fail' | 'error';
  public readonly isOperational: boolean;
  public readonly code?: string;
  public details?: Array<{ field?: string; path?: string; message: string }>;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.status = statusCode < 500 ? 'fail' : 'error';
    this.isOperational = true;
    this.code = code;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

// ─── Error normalizers ─────────────────────────────────────────────────────────

function handleZodError(err: ZodError) {
  const details = err.issues.map((i) => ({
    path: i.path.join('.'),
    message: i.message,
  }));
  const appErr = new AppError('Validation failed', 400, 'VALIDATION_ERROR');
  appErr.details = details;
  return appErr;
}

function handleMongooseValidation(err: mongoose.Error.ValidationError) {
  const details = Object.values(err.errors).map((e) => e.message);
  return new AppError(`Invalid input: ${details.join(', ')}`, 400, 'VALIDATION_ERROR');
}

function handleDuplicateKey(err: any) {
  const field = Object.keys(err.keyValue || {})[0] ?? 'field';
  return new AppError(`Duplicate value for "${field}"`, 409, 'DUPLICATE_KEY');
}

function handleCastError(err: mongoose.Error.CastError) {
  return new AppError(`Invalid ${err.path}: ${err.value}`, 400, 'CAST_ERROR');
}

function handleJwtError() {
  return new AppError('Invalid or expired token', 401, 'INVALID_TOKEN');
}

// ─── Global handler ────────────────────────────────────────────────────────────

/**
 * Express global error handler — must be registered **last** in the middleware
 * chain (`app.use(globalErrorHandler)`).
 *
 * Normalises known error types into a uniform JSON shape.
 * In dev: includes the stack trace. In prod: omits it.
 */
export function globalErrorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  let error = err;

  if (err instanceof ZodError) error = handleZodError(err);
  else if (err instanceof mongoose.Error.ValidationError) error = handleMongooseValidation(err);
  else if (err instanceof mongoose.Error.CastError) error = handleCastError(err);
  else if (err.code === 11000) error = handleDuplicateKey(err);
  else if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') error = handleJwtError();
  else if (
    err?.type === 'entity.too.large' ||
    err?.status === 413 ||
    err?.statusCode === 413 ||
    /request entity too large/i.test(String(err?.message ?? ''))
  ) {
    error = new AppError(
      'Scene payload is too large to save. Remove some objects or simplify the scene, then try again.',
      413,
      'PAYLOAD_TOO_LARGE',
    );
  } else if (
    err?.name === 'MongoServerError' &&
    (/larger than|document.*too large|BSONObj size/i.test(String(err?.message ?? '')) || err?.code === 10334)
  ) {
    error = new AppError(
      'Scene document exceeds MongoDB’s 16MB limit. Split the scene or remove placements.',
      413,
      'DOCUMENT_TOO_LARGE',
    );
  }

  const statusCode: number = error.statusCode || 500;
  const status: string = error.status || 'error';
  const message: string = error.isOperational ? error.message : 'Something went wrong';

  if (statusCode >= 500) {
    log.error({ err, statusCode }, message);
  }

  res.status(statusCode).json({
    success: false,
    status,
    message,
    ...(error.code && { code: error.code }),
    ...(error.details && { details: error.details }),
    ...(isDev && { stack: err.stack }),
  });
}
