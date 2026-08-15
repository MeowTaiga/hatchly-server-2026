import { Router } from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { UserEntity } from '../entities/UserEntity.js';
import { validate } from '../middleware/validate.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { AppError } from '../middleware/errorHandler.js';
import { isDev } from '../config/env.js';

/**
 * Passwordless auth shortcuts for local tooling (the admin web console).
 *
 * Normal sign-in requires a Twilio SMS round-trip, which is impractical for a
 * desktop tool running against a local database. This router is only mounted
 * when NODE_ENV is a development value, and every handler re-checks that flag
 * so an accidental mount in production still yields a 404.
 */
const router = Router();

router.use((_req, _res, next) => {
  if (!isDev) return next(new AppError('Route not found', 404, 'NOT_FOUND'));
  next();
});

const listSchema = {
  query: z.object({ q: z.string().optional() }),
};

const userIdSchema = {
  body: z.object({ userId: z.string().min(1) }),
};

const promoteSchema = {
  body: z.object({
    userId: z.string().min(1),
    role: z.enum(['user', 'admin', 'superadmin']).default('admin'),
  }),
};

/**
 * GET /dev-auth/users
 * Lists accounts so the console can offer a picker. Admins first, then the
 * most recently active users, so the common case needs no searching.
 */
router.get(
  '/users',
  validate(listSchema),
  catchAsync(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const filter = q
      ? {
          $or: [
            { username: { $regex: q, $options: 'i' } },
            { phone: { $regex: q, $options: 'i' } },
          ],
        }
      : {};

    const users = await User.find(filter)
      .select('_id username phone role lastLogin')
      .sort({ lastLogin: -1 })
      .limit(50)
      .lean();

    const rank = (role: string) => (role === 'superadmin' ? 0 : role === 'admin' ? 1 : 2);

    success(res, {
      users: users
        .map((u) => ({
          id: String(u._id),
          username: u.username ?? null,
          phone: u.phone,
          role: u.role,
          lastLogin: u.lastLogin,
        }))
        .sort((a, b) => rank(a.role) - rank(b.role)),
    });
  }),
);

/**
 * POST /dev-auth/login
 * Issues a normal JWT for any account without an SMS code.
 */
router.post(
  '/login',
  validate(userIdSchema),
  catchAsync(async (req, res) => {
    const doc = await User.findById(req.body.userId);
    if (!doc) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

    const { token, user } = await UserEntity.fromDoc(doc).login();
    success(res, { token, user });
  }),
);

/**
 * POST /dev-auth/promote
 * Grants a role locally. There is no production API for this, so without it
 * bootstrapping the first admin means editing MongoDB by hand.
 */
router.post(
  '/promote',
  validate(promoteSchema),
  catchAsync(async (req, res) => {
    const { userId, role } = req.body;
    const doc = await User.findById(userId);
    if (!doc) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

    doc.role = role;
    await doc.save();

    success(res, { id: String(doc._id), username: doc.username ?? null, role: doc.role });
  }),
);

export default router;
