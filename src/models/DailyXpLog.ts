import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

// ─── Interface ──────────────────────────────────────────────────────────────

export interface IDailyXpLog extends Document {
  userId: mongoose.Types.ObjectId;
  /** YYYY-MM-DD date string */
  date: string;
  /** Action category that earned XP (e.g. "food", "water", "weight") */
  action: string;
  /** How many XP-eligible actions have been performed today for this category */
  count: number;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Schema ─────────────────────────────────────────────────────────────────

const dailyXpLogSchema = new Schema<IDailyXpLog>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true },
  action: { type: String, required: true },
  count: { type: Number, default: 0 },
});

// One entry per user per day per action type
dailyXpLogSchema.index({ userId: 1, date: 1, action: 1 }, { unique: true });

dailyXpLogSchema.plugin(basePlugin);

export const DailyXpLog = mongoose.model<IDailyXpLog>('DailyXpLog', dailyXpLogSchema);
