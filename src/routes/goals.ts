import { Router } from 'express';
import { z } from 'zod';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  archiveGoal,
  archiveSharedGoal,
  completeGoal,
  completeSharedGoal,
  createCustomGoal,
  createSharedGoal,
  endGoalMarriage,
  getGoalHistory,
  getGoalsToday,
  proposeGoalMarriage,
  respondToGoalMarriage,
  shareCustomGoal,
  uncompleteGoal,
  uncompleteSharedGoal,
  updateGoal,
  updateSharedGoal,
} from '../services/GoalService.js';

const router = Router();

const remindAt = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional();
const repeatDays = z.array(z.number().int().min(0).max(6)).max(7).optional();
const repeat = z.enum(['daily', 'weekdays', 'once']).optional();

const createSchema = {
  body: z.object({
    title: z.string().trim().min(1).max(80),
    notes: z.string().trim().optional(),
    iconItemType: z.string().min(1).max(80).optional(),
    repeat,
    repeatDays,
    remindAt,
    section: z.string().trim().max(32).nullable().optional(),
    sectionIconItemType: z.string().min(1).max(80).optional(),
  }).strict(),
};

const updateSchema = {
  body: z.object({
    title: z.string().trim().min(1).max(80).optional(),
    notes: z.string().trim().nullable().optional(),
    iconItemType: z.string().min(1).max(80).optional(),
    repeat,
    repeatDays,
    remindAt,
    section: z.string().trim().max(32).nullable().optional(),
    sectionIconItemType: z.string().min(1).max(80).optional(),
    enabled: z.boolean().optional(),
  }).strict(),
};

function requireUserId(req: { user?: { _id?: { toString?: () => string } } }): string {
  const userId = req.user?._id?.toString?.();
  if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');
  return userId;
}

router.get(
  '/',
  protect,
  catchAsync(async (req, res) => {
    success(res, await getGoalsToday(requireUserId(req)));
  }),
);

const historyQuery = {
  query: z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
};

router.get(
  '/history',
  protect,
  validate(historyQuery),
  catchAsync(async (req, res) => {
    const { start, end } = req.query as { start: string; end: string };
    success(res, await getGoalHistory(requireUserId(req), start, end));
  }),
);

router.post(
  '/',
  protect,
  validate(createSchema),
  catchAsync(async (req, res) => {
    success(res, await createCustomGoal(requireUserId(req), req.body), 201);
  }),
);

router.post(
  '/marriage/propose',
  protect,
  validate({ body: z.object({ userId: z.string().min(1) }).strict() }),
  catchAsync(async (req, res) => {
    success(res, await proposeGoalMarriage(requireUserId(req), req.body.userId), 201);
  }),
);

router.patch(
  '/marriage/:id',
  protect,
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({ status: z.enum(['accepted', 'rejected']) }).strict(),
  }),
  catchAsync(async (req, res) => {
    success(res, await respondToGoalMarriage(requireUserId(req), String(req.params.id), req.body.status));
  }),
);

router.delete(
  '/marriage',
  protect,
  catchAsync(async (req, res) => {
    success(res, await endGoalMarriage(requireUserId(req)));
  }),
);

router.post(
  '/shared',
  protect,
  validate(createSchema),
  catchAsync(async (req, res) => {
    success(res, await createSharedGoal(requireUserId(req), req.body), 201);
  }),
);

router.post(
  '/:id/share',
  protect,
  validate({ ...updateSchema, params: z.object({ id: z.string().min(1) }) }),
  catchAsync(async (req, res) => {
    success(res, await shareCustomGoal(requireUserId(req), String(req.params.id), req.body));
  }),
);

router.patch(
  '/shared/:id',
  protect,
  validate({ ...updateSchema, params: z.object({ id: z.string().min(1) }) }),
  catchAsync(async (req, res) => {
    success(res, await updateSharedGoal(requireUserId(req), String(req.params.id), req.body));
  }),
);

router.delete(
  '/shared/:id',
  protect,
  catchAsync(async (req, res) => {
    success(res, await archiveSharedGoal(requireUserId(req), String(req.params.id)));
  }),
);

router.post(
  '/shared/:id/complete',
  protect,
  catchAsync(async (req, res) => {
    success(res, await completeSharedGoal(requireUserId(req), String(req.params.id)));
  }),
);

router.post(
  '/shared/:id/uncomplete',
  protect,
  catchAsync(async (req, res) => {
    success(res, await uncompleteSharedGoal(requireUserId(req), String(req.params.id)));
  }),
);

router.patch(
  '/:id',
  protect,
  validate(updateSchema),
  catchAsync(async (req, res) => {
    success(res, await updateGoal(requireUserId(req), String(req.params.id), req.body));
  }),
);

router.delete(
  '/:id',
  protect,
  catchAsync(async (req, res) => {
    success(res, await archiveGoal(requireUserId(req), String(req.params.id)));
  }),
);

router.post(
  '/:id/complete',
  protect,
  catchAsync(async (req, res) => {
    success(res, await completeGoal(requireUserId(req), String(req.params.id)));
  }),
);

router.post(
  '/:id/uncomplete',
  protect,
  catchAsync(async (req, res) => {
    success(res, await uncompleteGoal(requireUserId(req), String(req.params.id)));
  }),
);

export default router;
