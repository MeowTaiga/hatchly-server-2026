import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export const MOOD_OPTIONS = ['great', 'good', 'okay', 'meh', 'down', 'anxious', 'excited'] as const;
export type MoodOption = (typeof MOOD_OPTIONS)[number];

/**
 * User mood diary entry. Multiple logs per day are allowed; rewards are gated
 * separately by a 3-hour cooldown (see MoodDiaryRewardService).
 */
export interface IMoodLog extends Document {
  userId: mongoose.Types.ObjectId;
  /** YYYY-MM-DD string (timezone calendar day) */
  date: string;
  mood: MoodOption;
  /** Optional diary note */
  note?: string;
  /** True when this entry granted XP/gems/item rewards */
  rewarded: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const moodLogSchema = new Schema<IMoodLog>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  date: { type: String, required: true, index: true },
  mood: { type: String, required: true, enum: MOOD_OPTIONS },
  note: { type: String, maxlength: 500 },
  rewarded: { type: Boolean, default: false },
});

// Non-unique — diary allows multiple check-ins per day.
// Named distinctly so we can drop the legacy unique `userId_1_date_1` without
// removing this index on every boot.
moodLogSchema.index({ userId: 1, date: 1 }, { name: 'mood_diary_user_date' });
moodLogSchema.index({ userId: 1, createdAt: -1 });
moodLogSchema.index({ userId: 1, rewarded: 1, createdAt: -1 });
moodLogSchema.plugin(basePlugin);

export const MoodLog = mongoose.model<IMoodLog>('MoodLog', moodLogSchema);

// Drop the legacy unique { userId, date } index if it still exists from older deploys.
MoodLog.collection
  .dropIndex('userId_1_date_1')
  .catch(() => undefined);
