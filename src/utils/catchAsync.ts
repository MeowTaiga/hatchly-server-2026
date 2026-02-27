import type { Request, Response, NextFunction } from 'express';

/**
 * Wraps an async Express route handler so thrown errors
 * automatically flow into the global error handler.
 *
 * Usage:
 * ```ts
 * router.get('/users', catchAsync(async (req, res) => {
 *   const users = await User.find();
 *   res.json(users);
 * }));
 * ```
 */
export const catchAsync = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
};
