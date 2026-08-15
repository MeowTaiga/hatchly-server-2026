import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export const FASTING_STATUSES = ['active', 'completed', 'broken'] as const;
export type FastingStatus = (typeof FASTING_STATUSES)[number];

export interface IFastingSession extends Document {
  userId: mongoose.Types.ObjectId;
  /** Calendar day the fast started (user-local YYYY-MM-DD). */
  date: string;
  goalHours: number;
  startedAt: Date;
  endsAt: Date;
  endedAt?: Date;
  status: FastingStatus;
  /** Set when the completion push/in-app notification has been sent. */
  notifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const fastingSessionSchema = new Schema<IFastingSession>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  date: { type: String, required: true },
  goalHours: { type: Number, required: true },
  startedAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  endedAt: { type: Date },
  status: { type: String, required: true, enum: FASTING_STATUSES, default: 'active' },
  notifiedAt: { type: Date },
});

fastingSessionSchema.index({ userId: 1, status: 1 });
fastingSessionSchema.index({ userId: 1, startedAt: -1 });
fastingSessionSchema.index({ status: 1, endsAt: 1, notifiedAt: 1 });
fastingSessionSchema.plugin(basePlugin);

export const FastingSession = mongoose.model<IFastingSession>('FastingSession', fastingSessionSchema);
