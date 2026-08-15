import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';
import { GOAL_REPEATS, type GoalRepeatKind } from './UserGoal.js';

export interface ISharedGoal extends Document {
  marriageId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  title: string;
  notes?: string;
  iconItemType: string;
  rewardItemType: string;
  repeat: GoalRepeatKind;
  repeatDays: number[];
  remindAt?: string;
  enabled: boolean;
  archived: boolean;
  lastRemindedDateStr?: string;
  section?: string;
  sectionIconItemType?: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const sharedGoalSchema = new Schema<ISharedGoal>({
  marriageId: { type: Schema.Types.ObjectId, ref: 'Marriage', required: true, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true, maxlength: 80 },
  notes: { type: String, trim: true },
  iconItemType: { type: String, required: true },
  rewardItemType: { type: String, required: true },
  repeat: { type: String, required: true, enum: GOAL_REPEATS, default: 'daily' },
  repeatDays: { type: [Number], default: [] },
  remindAt: { type: String },
  enabled: { type: Boolean, required: true, default: true },
  archived: { type: Boolean, required: true, default: false },
  lastRemindedDateStr: { type: String },
  section: { type: String, trim: true, maxlength: 32 },
  sectionIconItemType: { type: String, trim: true, maxlength: 80 },
  sortOrder: { type: Number, required: true, default: 0 },
});

sharedGoalSchema.index({ marriageId: 1, archived: 1, enabled: 1 });
sharedGoalSchema.plugin(basePlugin);

export const SharedGoal = mongoose.model<ISharedGoal>('SharedGoal', sharedGoalSchema);
