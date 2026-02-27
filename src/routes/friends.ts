import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { Friend } from '../models/Friend.js';
import { User } from '../models/User.js';
import { normalizePhone } from '../utils/phone.js';
import { notificationService } from '../services/NotificationService.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const last4 = digits.slice(-4);
  return `***${last4}`;
}

function toMinimalUser(user: {
  _id: mongoose.Types.ObjectId;
  username?: string;
  phone: string;
  pet?: { name: string; customName: string; imageUrl: string };
}) {
  return {
    id: user._id.toString(),
    username: user.username ?? undefined,
    phone: maskPhone(user.phone),
    pet: user.pet
      ? {
          name: user.pet.name,
          customName: user.pet.customName,
          imageUrl: user.pet.imageUrl,
        }
      : undefined,
  };
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const searchSchema = {
  query: z.object({
    q: z.string().min(1, 'Search query is required'),
  }),
};

const requestSchema = {
  body: z.object({
    userId: z.string().min(1, 'userId is required'),
  }),
};

const respondSchema = {
  params: z.object({
    id: z.string().min(1, 'Friend request id is required'),
  }),
  body: z.object({
    status: z.enum(['accepted', 'rejected']),
  }),
};

const deleteSchema = {
  params: z.object({
    userId: z.string().min(1, 'userId is required'),
  }),
};

// ─── GET /friends/search ──────────────────────────────────────────────────────

/**
 * Search users by phone (E.164 normalized) or username (case-insensitive).
 * Excludes self, already friends, and pending requests.
 */
router.get(
  '/search',
  protect,
  validate(searchSchema),
  catchAsync(async (req, res) => {
    const meId = req.user?._id?.toString();
    if (!meId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const { q } = req.query;
    const trimmed = String(q).trim();
    if (!trimmed) {
      return success(res, []);
    }

    const meObjectId = new mongoose.Types.ObjectId(meId);

    const existingDocs = await Friend.find({
      $or: [
        { fromUserId: meObjectId },
        { toUserId: meObjectId },
      ],
      status: { $in: ['pending', 'accepted'] },
    }).lean();

    const existingFriendUserIds = [
      ...new Set(
        existingDocs.flatMap((d) => [
          d.fromUserId.toString(),
          d.toUserId.toString(),
        ]).filter((id) => id !== meId),
      ),
    ];

    const excludeIds = [meId, ...new Set(existingFriendUserIds)].map(
      (id) => new mongoose.Types.ObjectId(id),
    );

    const digitsOnly = trimmed.replace(/\D/g, '');
    const isPhoneSearch = digitsOnly.length >= 10;

    let users: Array<{
      _id: mongoose.Types.ObjectId;
      username?: string;
      phone: string;
      pet?: { name: string; customName: string; imageUrl: string };
    }>;

    if (isPhoneSearch) {
      const normalized = normalizePhone(trimmed);
      users = await User.find({
        _id: { $nin: excludeIds },
        phone: normalized,
        status: 'active',
      })
        .select('username phone pet')
        .lean();
    } else {
      const usernameRegex = new RegExp(
        `^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        'i',
      );
      users = await User.find({
        _id: { $nin: excludeIds },
        username: usernameRegex,
        status: 'active',
      })
        .select('username phone pet')
        .limit(20)
        .lean();
    }

    success(res, users.map(toMinimalUser));
  }),
);

// ─── POST /friends/request ────────────────────────────────────────────────────

/**
 * Create a friend request (status: pending).
 * Validates: not self, not already friends/pending.
 */
router.post(
  '/request',
  protect,
  validate(requestSchema),
  catchAsync(async (req, res) => {
    const meId = req.user?._id?.toString();
    if (!meId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const { userId } = req.body;

    if (userId === meId) {
      throw new AppError('Cannot send friend request to yourself', 400, 'SELF_REQUEST');
    }

    const toUserId = new mongoose.Types.ObjectId(userId);
    const fromUserId = new mongoose.Types.ObjectId(meId);

    const targetUser = await User.findById(toUserId);
    if (!targetUser || targetUser.status !== 'active') {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    const existing = await Friend.findOne({
      $or: [
        { fromUserId, toUserId },
        { fromUserId: toUserId, toUserId: fromUserId },
      ],
    });

    if (existing) {
      if (existing.status === 'accepted') {
        throw new AppError('Already friends', 400, 'ALREADY_FRIENDS');
      }
      throw new AppError('Friend request already exists', 400, 'REQUEST_EXISTS');
    }

    const friend = await Friend.create({
      fromUserId,
      toUserId,
      status: 'pending',
    });

    const fromUser = await User.findById(meId).select('username').lean();
    await notificationService.createAndDeliver(userId, 'friend_request', {
      friendRequestId: friend.id,
      fromUserId: meId,
      fromUsername: fromUser?.username,
    });

    success(res, { id: friend.id, status: friend.status }, 201);
  }),
);

// ─── GET /friends ─────────────────────────────────────────────────────────────

/**
 * Returns friends (accepted, both directions), sent (pending from me), received (pending to me).
 * Includes minimal user info and pet.
 */
router.get(
  '/',
  protect,
  catchAsync(async (req, res) => {
    const meId = req.user?._id?.toString();
    if (!meId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const meObjectId = new mongoose.Types.ObjectId(meId);

    const [acceptedDocs, sentDocs, receivedDocs] = await Promise.all([
      Friend.find({
        $or: [
          { fromUserId: meObjectId, status: 'accepted' },
          { toUserId: meObjectId, status: 'accepted' },
        ],
      })
        .populate('fromUserId', 'username phone pet')
        .populate('toUserId', 'username phone pet')
        .lean(),
      Friend.find({ fromUserId: meObjectId, status: 'pending' })
        .populate('toUserId', 'username phone pet')
        .lean(),
      Friend.find({ toUserId: meObjectId, status: 'pending' })
        .populate('fromUserId', 'username phone pet')
        .lean(),
    ]);

    const friends = acceptedDocs.map((doc) => {
      const other =
        doc.fromUserId._id.toString() === meId ? doc.toUserId : doc.fromUserId;
      return {
        id: doc._id.toString(),
        user: toMinimalUser(other as any),
        status: 'accepted',
      };
    });

    const sent = sentDocs.map((doc) => ({
      id: doc._id.toString(),
      user: toMinimalUser(doc.toUserId as any),
      status: 'pending',
    }));

    const received = receivedDocs.map((doc) => ({
      id: doc._id.toString(),
      user: toMinimalUser(doc.fromUserId as any),
      status: 'pending',
    }));

    success(res, { friends, sent, received });
  }),
);

// ─── PATCH /friends/request/:id ──────────────────────────────────────────────

/**
 * Accept or reject a friend request. Only toUserId (recipient) can respond.
 */
router.patch(
  '/request/:id',
  protect,
  validate(respondSchema),
  catchAsync(async (req, res) => {
    const meId = req.user?._id?.toString();
    if (!meId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const id = String(req.params.id);
    const { status } = req.body;

    const requestId = new mongoose.Types.ObjectId(id);
    const friend = await Friend.findById(requestId);

    if (!friend) {
      throw new AppError('Friend request not found', 404, 'NOT_FOUND');
    }

    if (friend.toUserId.toString() !== meId) {
      throw new AppError('Only the recipient can respond to this request', 403, 'FORBIDDEN');
    }

    if (friend.status !== 'pending') {
      throw new AppError('Request has already been responded to', 400, 'ALREADY_RESPONDED');
    }

    friend.status = status;
    await friend.save();

    if (status === 'accepted') {
      const me = await User.findById(meId).select('username').lean();
      const fromUserIdStr = friend.fromUserId.toString();
      await notificationService.createAndDeliver(fromUserIdStr, 'friend_accepted', {
        friendRequestId: friend.id,
        fromUserId: meId,
        fromUsername: me?.username,
      });
    }

    success(res, { id: friend.id, status: friend.status });
  }),
);

// ─── DELETE /friends/:userId ──────────────────────────────────────────────────

/**
 * Remove friendship (both directions if accepted) or cancel a pending request.
 */
router.delete(
  '/:userId',
  protect,
  validate(deleteSchema),
  catchAsync(async (req, res) => {
    const meId = req.user?._id?.toString();
    if (!meId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const userId = String(req.params.userId);
    const meObjectId = new mongoose.Types.ObjectId(meId);
    const otherObjectId = new mongoose.Types.ObjectId(userId);

    const deleted = await Friend.deleteMany({
      $or: [
        { fromUserId: meObjectId, toUserId: otherObjectId },
        { fromUserId: otherObjectId, toUserId: meObjectId },
      ],
    });

    if (deleted.deletedCount === 0) {
      throw new AppError('Friendship or request not found', 404, 'NOT_FOUND');
    }

    success(res, { deleted: deleted.deletedCount });
  }),
);

export default router;
