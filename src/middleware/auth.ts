import type { Request, Response, NextFunction } from 'express';
import { User } from '../models/User.js';
import { verifyJwt } from '../utils/token.js';
import { AppError } from './errorHandler.js';

/**
 * Extracts the Bearer token from the Authorization header.
 * Returns `null` if the header is missing or malformed.
 */
function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7);
}

/**
 * Requires a valid JWT. Loads the user from the database and attaches
 * it to `req.user`. Rejects with 401 if the token is missing, expired,
 * or the user no longer exists.
 */
export async function protect(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) throw new AppError('Authentication required', 401, 'NO_TOKEN');

    const { userId } = verifyJwt(token);
    const user = await User.findById(userId);

    if (!user) throw new AppError('User no longer exists', 401, 'USER_NOT_FOUND');
    if (user.status === 'suspended') throw new AppError('Account suspended', 403, 'ACCOUNT_SUSPENDED');

    req.user = user;
    next();
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(new AppError('Invalid or expired token', 401, 'INVALID_TOKEN'));
  }
}

/**
 * Checks that the authenticated user has one of the required roles.
 * Must be used **after** `protect()`.
 *
 * @example
 * router.delete('/users/:id', protect, requireRole('admin', 'superadmin'), handler);
 */
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401, 'NO_TOKEN'));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError('Insufficient permissions', 403, 'FORBIDDEN'));
    }
    next();
  };
}

/**
 * Like `protect()` but does **not** reject when no token is present.
 * If a valid token exists the user is attached to `req.user`; otherwise
 * the request continues with `req.user` as `undefined`.
 *
 * Useful for endpoints that behave differently for logged-in vs anonymous users.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) return next();

    const { userId } = verifyJwt(token);
    const user = await User.findById(userId);

    if (user && user.status !== 'suspended') {
      req.user = user;
    }
  } catch {
    // Token invalid / expired — silently continue without user
  }
  next();
}
