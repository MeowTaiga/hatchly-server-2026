import { Router } from 'express';
import { z } from 'zod';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { chatLimiter } from '../middleware/rateLimiter.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { getHistory, getChatStatus, sendMessage } from '../services/PetChatService.js';
import { grantSuggestionReward } from '../services/SuggestionRewardService.js';

const router = Router();

const sendSchema = {
  body: z.object({
    content: z.string().min(1, 'Message cannot be empty').max(500, 'Message too long'),
  }).strict(),
};

const completeSuggestionSchema = {
  body: z.object({
    messageId: z.string().min(1, 'Message ID is required'),
  }).strict(),
};

router.get(
  '/history',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user!._id.toString();
    const timezone = (req.user as any).timezone;
    const [messages, status] = await Promise.all([
      getHistory(userId, timezone),
      getChatStatus(userId, timezone),
    ]);
    success(res, { messages, needsMoodToday: status.needsMoodToday });
  }),
);

router.post(
  '/send',
  chatLimiter,
  protect,
  validate(sendSchema),
  catchAsync(async (req, res) => {
    const userId = req.user!._id.toString();
    const { content } = req.body as { content: string };
    const result = await sendMessage(userId, content);
    success(res, result);
  }),
);

router.post(
  '/complete-suggestion',
  chatLimiter,
  protect,
  validate(completeSuggestionSchema),
  catchAsync(async (req, res) => {
    const userId = req.user!._id.toString();
    const timezone = (req.user as any).timezone;
    const { messageId } = req.body as { messageId: string };
    const result = await grantSuggestionReward(userId, messageId, timezone);
    success(res, result);
  }),
);

export default router;
