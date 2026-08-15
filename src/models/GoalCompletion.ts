import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export interface IGoalCompletion extends Document {
  userId: mongoose.Types.ObjectId;
  goalId: mongoose.Types.ObjectId;
  /** User-local YYYY-MM-DD */
  dateStr: string;
  /** Currently checked off. Undo clears this; reward history stays. */
  checked: boolean;
  rewarded: boolean;
  /** 0..MAX-1 unique per user+day. Occupying a slot is the reward grant lock. */
  rewardSlot?: number;
  createdAt: Date;
  updatedAt: Date;
}

const goalCompletionSchema = new Schema<IGoalCompletion>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  goalId: { type: Schema.Types.ObjectId, ref: 'UserGoal', required: true },
  dateStr: { type: String, required: true },
  checked: { type: Boolean, required: true, default: true },
  rewarded: { type: Boolean, required: true, default: false },
  rewardSlot: { type: Number, min: 0 },
});

goalCompletionSchema.index({ userId: 1, goalId: 1, dateStr: 1 }, { unique: true });
goalCompletionSchema.index({ userId: 1, dateStr: 1 });
goalCompletionSchema.index(
  { userId: 1, dateStr: 1, rewardSlot: 1 },
  { unique: true, partialFilterExpression: { rewardSlot: { $type: 'number' } } },
);
goalCompletionSchema.plugin(basePlugin);

export const GoalCompletion = mongoose.model<IGoalCompletion>('GoalCompletion', goalCompletionSchema);
