import rateLimit, { type Options } from 'express-rate-limit';

/**
 * Creates an Express rate-limiter with the given options.
 * All limiters return a standard JSON error shape on breach.
 */
export function createLimiter(opts: Partial<Options>) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      status: 'fail',
      message: 'Too many requests — please try again later',
      code: 'RATE_LIMIT',
    },
    ...opts,
  });
}

/**
 * Strict limiter for authentication endpoints (request code, verify code).
 * 5 attempts per 15-minute window per IP.
 */
export const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
});

/**
 * General API limiter.
 * 1000 requests per 15-minute window per IP.
 */
export const apiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 1000,
});

/**
 * Chat endpoint limiter — stricter to limit token cost.
 * 30 requests per 15-minute window per IP.
 */
export const chatLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
