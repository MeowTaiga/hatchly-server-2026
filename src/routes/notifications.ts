import { Router } from 'express';
import { z } from 'zod';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { notificationService } from '../services/NotificationService.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// ─── Schemas ─────────────────────────────────────────────────────────────

const listSchema = {
  query: z.object({
    limit: z.coerce.number().min(1).max(50).optional(),
    before: z.string().min(1).optional(),
  }),
};

const readSchema = {
  params: z.object({
    id: z.string().min(1, 'Notification id is required'),
  }),
};

// ─── GET /notifications ───────────────────────────────────────────────────

/**
 * Returns paginated notifications for the authenticated user.
 *
 * @query limit — Max 50, default 20
 * @query before — Cursor (notification id) for pagination
 */
router.get(
  '/',
  protect,
  validate(listSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const { limit, before } = req.query as { limit?: number; before?: string };
    const result = await notificationService.getForUser(userId, { limit, before });

    success(res, result);
  }),
);

// ─── PATCH /notifications/read-all ────────────────────────────────────────

/**
 * Marks all notifications for the user as read.
 * Must be defined before /:id/read to avoid 'read-all' being parsed as id.
 */
router.patch(
  '/read-all',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    await notificationService.markAllRead(userId);

    success(res, { read: true });
  }),
);

// ─── PATCH /notifications/:id/read ───────────────────────────────────────

/**
 * Marks a single notification as read.
 */
router.patch(
  '/:id/read',
  protect,
  validate(readSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const { id } = req.params;
    await notificationService.markRead(id, userId);

    success(res, { read: true });
  }),
);

export default router;
