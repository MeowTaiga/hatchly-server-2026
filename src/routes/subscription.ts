import { Router } from 'express';
import { z } from 'zod';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { createLogger } from '../config/logger.js';
import { Subscription, type ISubscription } from '../models/Subscription.js';
import { AppError } from '../middleware/errorHandler.js';

const log = createLogger('SubscriptionRoute');
const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Compute period end from a start date and plan type. */
function computePeriodEnd(start: Date, plan: 'monthly' | 'yearly'): Date {
  const end = new Date(start);
  if (plan === 'yearly') {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  return end;
}

/** Return a sanitised subscription summary for the client. */
function toPublicSubscription(sub: ISubscription) {
  return {
    status: sub.status,
    plan: sub.plan,
    platform: sub.platform,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,
    trialStart: sub.trialStart,
    trialEnd: sub.trialEnd,
    cancelledAt: sub.cancelledAt,
  };
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const validateSchema = {
  body: z.object({
    platform: z.enum(['ios', 'android']),
    plan: z.enum(['monthly', 'yearly']),
    receipt: z.string(),
    purchaseToken: z.string(),
    productId: z.string().optional(),
    transactionId: z.string().optional(),
  }),
};

const trialSchema = {
  body: z.object({
    plan: z.enum(['monthly', 'yearly']).default('yearly'),
  }),
};

// ─── POST /subscription/validate ─────────────────────────────────────────────

/**
 * Called after a successful IAP purchase on the client.
 *
 * Upserts the user's subscription record with the receipt, sets status
 * to 'active', and computes the current billing period dates.
 *
 * In a production app this is where you'd verify the receipt with
 * Apple/Google servers — for now we trust the client receipt and persist it
 * so it can be verified later or in a webhook.
 */
router.post(
  '/validate',
  protect,
  validate(validateSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const { platform, plan, receipt, purchaseToken, productId, transactionId } = req.body;

    log.info(
      { userId, platform, plan, productId, transactionId, receiptLen: receipt?.length },
      '[validate] Incoming subscription purchase validation',
    );

    const existing = await Subscription.findOne({ userId });
    if (existing) {
      log.info(
        { userId, existingStatus: existing.status, existingPlan: existing.plan },
        '[validate] Found existing subscription record',
      );
    }

    const now = new Date();
    const periodEnd = computePeriodEnd(now, plan);

    const sub = await Subscription.findOneAndUpdate(
      { userId },
      {
        userId,
        status: 'active',
        plan,
        platform,
        productId: productId ?? '',
        transactionId: transactionId ?? '',
        receipt,
        purchaseToken,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelledAt: null,
      },
      { upsert: true, new: true, runValidators: true },
    );

    log.info(
      { userId, subscriptionId: sub._id, plan, periodEnd, status: sub.status },
      '[validate] Subscription purchase validated successfully',
    );

    success(res, { subscription: toPublicSubscription(sub) });
  }),
);

// ─── POST /subscription/trial ────────────────────────────────────────────────

/**
 * Starts a 7-day free trial for the authenticated user.
 *
 * If the user already has an active/trialing subscription, returns it
 * unchanged (idempotent).
 */
router.post(
  '/trial',
  protect,
  validate(trialSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const { plan } = req.body;

    log.info({ userId, plan }, '[trial] Trial start requested');

    const existing = await Subscription.findOne({ userId });
    if (existing) {
      log.info(
        { userId, existingStatus: existing.status, existingPlan: existing.plan, trialEnd: existing.trialEnd },
        '[trial] Found existing subscription record',
      );
    }
    if (existing && (existing.status === 'active' || existing.status === 'trialing')) {
      log.info({ userId, status: existing.status }, '[trial] User already has an active/trialing subscription — returning existing');
      return success(res, { subscription: toPublicSubscription(existing) });
    }

    const now = new Date();
    const trialEnd = new Date(now);
    trialEnd.setDate(trialEnd.getDate() + 7);

    log.info({ userId, plan, trialEnd }, '[trial] Creating 7-day free trial');

    const sub = await Subscription.findOneAndUpdate(
      { userId },
      {
        userId,
        status: 'trialing',
        plan,
        platform: 'web',
        trialStart: now,
        trialEnd,
        currentPeriodStart: now,
        currentPeriodEnd: trialEnd,
        cancelledAt: null,
      },
      { upsert: true, new: true, runValidators: true },
    );

    log.info(
      { userId, subscriptionId: sub._id, plan, trialEnd, status: sub.status },
      '[trial] Trial created successfully',
    );

    success(res, { subscription: toPublicSubscription(sub) }, 201);
  }),
);

// ─── GET /subscription/status ────────────────────────────────────────────────

/**
 * Returns the authenticated user's current subscription, or null.
 *
 * Automatically expires subscriptions whose `currentPeriodEnd` has passed.
 */
router.get(
  '/status',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const sub = await Subscription.findOne({ userId });

    if (!sub) {
      return success(res, { subscription: null });
    }

    // Auto-expire if period has lapsed
    const now = new Date();
    if (
      sub.currentPeriodEnd < now &&
      sub.status !== 'expired' &&
      sub.status !== 'cancelled'
    ) {
      sub.status = 'expired';
      await sub.save();
      log.info({ userId }, 'Subscription auto-expired');
    }

    success(res, { subscription: toPublicSubscription(sub) });
  }),
);

export default router;
