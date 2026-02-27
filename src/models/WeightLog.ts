import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export interface IWeightLog extends Document {
  userId: mongoose.Types.ObjectId;
  weight: number;
  date: string;
  createdAt: Date;
  updatedAt: Date;
}

const weightLogSchema = new Schema<IWeightLog>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  weight: { type: Number, required: true },
  /** YYYY-MM-DD string — one entry per user per day */
  date: { type: String, required: true },
});

weightLogSchema.index({ userId: 1, date: 1 }, { unique: true });
weightLogSchema.plugin(basePlugin);

export const WeightLog = mongoose.model<IWeightLog>('WeightLog', weightLogSchema);
