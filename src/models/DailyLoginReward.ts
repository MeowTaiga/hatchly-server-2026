import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

/**
 * Tracks daily login rewards per user. One document per user per calendar day (user timezone).
 * Used to ensure first-login-of-the-day rewards (fossil holes, stones/sticks, AI greeting)
 * are granted only once.
 */
export interface IDailyLoginReward extends Document {
  userId: mongoose.Types.ObjectId;
  /** YYYY-MM-DD in user's timezone */
  date: string;
  rewardedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const dailyLoginRewardSchema = new Schema<IDailyLoginReward>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  date: { type: String, required: true, index: true },
  rewardedAt: { type: Date, required: true, default: Date.now },
});

dailyLoginRewardSchema.index({ userId: 1, date: 1 }, { unique: true });
dailyLoginRewardSchema.plugin(basePlugin);

export const DailyLoginReward = mongoose.model<IDailyLoginReward>('DailyLoginReward', dailyLoginRewardSchema);
