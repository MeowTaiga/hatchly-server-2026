import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';
export type SubscriptionPlan = 'monthly' | 'yearly';
export type SubscriptionPlatform = 'ios' | 'android' | 'web';

// ─── Interface ──────────────────────────────────────────────────────────────

export interface ISubscription extends Document {
  /** Reference to the user who owns this subscription */
  userId: mongoose.Types.ObjectId;
  /** Current subscription lifecycle status */
  status: SubscriptionStatus;
  /** Billing plan */
  plan: SubscriptionPlan;
  /** Platform the purchase originated from */
  platform: SubscriptionPlatform;
  /** Store product identifier (SKU) */
  productId: string;
  /** Store transaction ID for reference */
  transactionId: string;
  /** Latest receipt data for server-side re-validation */
  receipt: string;
  /** Google Play purchase token */
  purchaseToken: string;
  /** When the free trial started */
  trialStart: Date | null;
  /** When the free trial ends */
  trialEnd: Date | null;
  /** Start of the current billing period */
  currentPeriodStart: Date;
  /** End of the current billing period — the "expiry" date */
  currentPeriodEnd: Date;
  /** When the user cancelled (null if still active) */
  cancelledAt: Date | null;
  /** Managed by Mongoose timestamps plugin */
  createdAt: Date;
  updatedAt: Date;
}

// ─── Schema ─────────────────────────────────────────────────────────────────

const subscriptionSchema = new Schema<ISubscription>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['trialing', 'active', 'past_due', 'cancelled', 'expired'],
    default: 'trialing',
  },
  plan: {
    type: String,
    enum: ['monthly', 'yearly'],
    required: true,
  },
  platform: {
    type: String,
    enum: ['ios', 'android', 'web'],
    default: 'ios',
  },
  productId: { type: String, default: '' },
  transactionId: { type: String, default: '' },
  receipt: { type: String, default: '' },
  purchaseToken: { type: String, default: '' },
  trialStart: { type: Date, default: null },
  trialEnd: { type: Date, default: null },
  currentPeriodStart: { type: Date, required: true },
  currentPeriodEnd: { type: Date, required: true },
  cancelledAt: { type: Date, default: null },
});

subscriptionSchema.plugin(basePlugin);

// ─── Model ──────────────────────────────────────────────────────────────────

export const Subscription = mongoose.model<ISubscription>(
  'Subscription',
  subscriptionSchema,
);
