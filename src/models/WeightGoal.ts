import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export interface IWeightGoal extends Document {
  userId: mongoose.Types.ObjectId;
  /** Target weight in lbs */
  targetWeight: number;
  /** Number of months to reach goal */
  timelineMonths: number;
  /** Target date (computed from timeline) */
  targetDate: Date;
  /** Estimated TDEE at time of goal creation */
  tdee: number;
  /** Calculated daily calorie target */
  dailyCalories: number;
  /** Weekly weight change rate in lbs (negative = loss) */
  weeklyRateLbs: number;
  createdAt: Date;
  updatedAt: Date;
}

const weightGoalSchema = new Schema<IWeightGoal>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  targetWeight: { type: Number, required: true },
  timelineMonths: { type: Number, required: true },
  targetDate: { type: Date, required: true },
  tdee: { type: Number, required: true },
  dailyCalories: { type: Number, required: true },
  weeklyRateLbs: { type: Number, required: true },
});

weightGoalSchema.plugin(basePlugin);

export const WeightGoal = mongoose.model<IWeightGoal>('WeightGoal', weightGoalSchema);
