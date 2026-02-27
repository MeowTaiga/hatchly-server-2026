import type { Response } from 'express';

/**
 * Sends a uniform success response.
 *
 * ```json
 * { "success": true, "data": { ... } }
 * ```
 */
export function success<T>(res: Response, data: T, statusCode = 200): void {
  res.status(statusCode).json({ success: true, data });
}

/**
 * Sends a paginated success response.
 *
 * ```json
 * {
 *   "success": true,
 *   "data": [ ... ],
 *   "pagination": { "page": 1, "limit": 20, "total": 57, "pages": 3 }
 * }
 * ```
 */
export function paginated<T>(
  res: Response,
  data: T[],
  total: number,
  page: number,
  limit: number,
): void {
  res.status(200).json({
    success: true,
    data,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
}
