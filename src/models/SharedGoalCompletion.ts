import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export interface ISharedGoalCompletion extends Document {
  marriageId: mongoose.Types.ObjectId;
  goalId: mongoose.Types.ObjectId;
  dateStr: string;
  checked: boolean;
  completedBy?: mongoose.Types.ObjectId;
  rewarded: boolean;
  /** Spouse who received a treat because the other person checked this off. */
  partnerId?: mongoose.Types.ObjectId;
  partnerRewarded: boolean;
  /** Partner-local YYYY-MM-DD used for their daily cap. */
  partnerRewardDateStr?: string;
  createdAt: Date;
  updatedAt: Date;
}

const sharedGoalCompletionSchema = new Schema<ISharedGoalCompletion>({
  marriageId: { type: Schema.Types.ObjectId, ref: 'Marriage', required: true },
  goalId: { type: Schema.Types.ObjectId, ref: 'SharedGoal', required: true },
  dateStr: { type: String, required: true },
  checked: { type: Boolean, required: true, default: true },
  completedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  rewarded: { type: Boolean, required: true, default: false },
  partnerId: { type: Schema.Types.ObjectId, ref: 'User' },
  partnerRewarded: { type: Boolean, required: true, default: false },
  partnerRewardDateStr: { type: String },
});

sharedGoalCompletionSchema.index({ marriageId: 1, goalId: 1, dateStr: 1 }, { unique: true });
sharedGoalCompletionSchema.index({ marriageId: 1, dateStr: 1 });
sharedGoalCompletionSchema.index({ completedBy: 1, dateStr: 1 });
sharedGoalCompletionSchema.index({ partnerId: 1, partnerRewardDateStr: 1 });
sharedGoalCompletionSchema.plugin(basePlugin);

export const SharedGoalCompletion = mongoose.model<ISharedGoalCompletion>(
  'SharedGoalCompletion',
  sharedGoalCompletionSchema,
);
