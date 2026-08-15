import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export const GOAL_SOURCES = ['catalog', 'custom'] as const;
export type GoalSource = (typeof GOAL_SOURCES)[number];

export const GOAL_REPEATS = ['daily', 'weekdays', 'once'] as const;
export type GoalRepeatKind = (typeof GOAL_REPEATS)[number];

export interface IUserGoal extends Document {
  userId: mongoose.Types.ObjectId;
  source: GoalSource;
  catalogId?: string;
  title: string;
  notes?: string;
  iconItemType: string;
  rewardItemType: string;
  repeat: GoalRepeatKind;
  /** Sunday = 0. Empty when repeat is daily. */
  repeatDays: number[];
  /** Local 24h time "HH:mm", or unset for no reminder. */
  remindAt?: string;
  enabled: boolean;
  archived: boolean;
  lastRemindedDateStr?: string;
  /** Optional group label, e.g. Household / Bills. */
  section?: string;
  /** Icon for the section this goal belongs to. */
  sectionIconItemType?: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const userGoalSchema = new Schema<IUserGoal>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  source: { type: String, required: true, enum: GOAL_SOURCES },
  catalogId: { type: String },
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

userGoalSchema.index({ userId: 1, archived: 1, enabled: 1 });
/** Only catalog rows — a sparse unique on userId+catalogId also indexes every custom goal (userId always exists) and blocks a second custom. */
userGoalSchema.index(
  { userId: 1, catalogId: 1 },
  {
    unique: true,
    name: 'userId_1_catalogId_1_partial',
    partialFilterExpression: { catalogId: { $type: 'string' } },
  },
);
userGoalSchema.index({ enabled: 1, archived: 1, remindAt: 1 });
userGoalSchema.plugin(basePlugin);

export const UserGoal = mongoose.model<IUserGoal>('UserGoal', userGoalSchema);

UserGoal.collection.dropIndex('userId_1_catalogId_1').catch(() => undefined);
