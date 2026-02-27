import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { achievementService } from '../services/AchievementService.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// ─── GET /achievements — all achievements with unlock status ────────────────

router.get(
  '/',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const achievements = await achievementService.getAllWithStatus(userId);
    success(res, { achievements });
  }),
);

// ─── GET /achievements/unlocked — only unlocked achievements ────────────────

router.get(
  '/unlocked',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const achievements = await achievementService.getUserAchievements(userId);
    success(res, { achievements });
  }),
);

export default router;
