import { Router } from 'express';
import { z } from 'zod';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { AppError } from '../middleware/errorHandler.js';
import { FASTING_HOURS_MAX, FASTING_HOURS_MIN, endFast, getFastingState, setFastingInterest, startFast } from '../services/FastingService.js';

const router = Router();

const interestSchema = {
  body: z.object({
    interested: z.boolean(),
  }).strict(),
};

const startSchema = {
  body: z.object({
    goalHours: z.number().int().min(FASTING_HOURS_MIN).max(FASTING_HOURS_MAX),
  }).strict(),
};

router.get(
  '/',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString?.();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');
    success(res, await getFastingState(userId));
  }),
);

router.patch(
  '/interest',
  protect,
  validate(interestSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString?.();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');
    success(res, await setFastingInterest(userId, req.body.interested));
  }),
);

router.post(
  '/start',
  protect,
  validate(startSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString?.();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');
    success(res, await startFast(userId, req.body.goalHours, req.user?.timezone), 201);
  }),
);

router.post(
  '/end',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString?.();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');
    success(res, await endFast(userId));
  }),
);

export default router;
