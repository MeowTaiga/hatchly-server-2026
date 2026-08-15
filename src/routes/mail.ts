import { Router } from 'express';
import { z } from 'zod';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { AppError } from '../middleware/errorHandler.js';
import { mailService } from '../services/MailService.js';

const router = Router();

const sendSchema = {
  body: z.object({
    toUserId: z.string().min(1, 'toUserId is required'),
    subject: z.string().min(1, 'Subject is required').max(200),
    body: z.string().min(1, 'Body is required').max(2000),
    attachedItems: z
      .array(
        z.object({
          itemType: z.string().min(1),
          qty: z.number().int().min(1),
        }),
      )
      .optional()
      .default([]),
  }),
};

const claimSchema = {
  params: z.object({
    id: z.string().min(1, 'Mail id is required'),
  }),
};

/**
 * GET /mail/inbox
 * List delivered mail for the current user.
 */
router.get(
  '/inbox',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const inbox = await mailService.listInbox(userId);
    success(res, { mail: inbox });
  }),
);

/**
 * POST /mail/send
 * Send mail to a friend.
 */
router.post(
  '/send',
  protect,
  validate(sendSchema),
  catchAsync(async (req, res) => {
    const fromUserId = req.user?._id?.toString();
    if (!fromUserId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const { toUserId, subject, body, attachedItems } = req.body;
    try {
      const mail = await mailService.sendToFriend(fromUserId, toUserId, subject, body, attachedItems ?? []);
      success(res, { mail });
    } catch (err) {
      throw new AppError(err instanceof Error ? err.message : 'Failed to send mail', 400, 'MAIL_SEND_FAILED');
    }
  }),
);

/**
 * POST /mail/:id/claim
 * Claim mail (receive attached items).
 */
router.post(
  '/:id/claim',
  protect,
  validate(claimSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    try {
      const result = await mailService.claimMail(userId, String(req.params.id));
      success(res, result);
    } catch (err) {
      throw new AppError(err instanceof Error ? err.message : 'Failed to claim mail', 400, 'MAIL_CLAIM_FAILED');
    }
  }),
);

export default router;
