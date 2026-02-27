import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export const MOOD_OPTIONS = ['great', 'good', 'okay', 'meh', 'down', 'anxious', 'excited'] as const;
export type MoodOption = (typeof MOOD_OPTIONS)[number];

export interface IMoodLog extends Document {
  userId: mongoose.Types.ObjectId;
  /** YYYY-MM-DD string */
  date: string;
  mood: MoodOption;
  createdAt: Date;
  updatedAt: Date;
}

const moodLogSchema = new Schema<IMoodLog>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  date: { type: String, required: true, index: true },
  mood: { type: String, required: true, enum: MOOD_OPTIONS },
});

moodLogSchema.index({ userId: 1, date: 1 }, { unique: true });
moodLogSchema.plugin(basePlugin);

export const MoodLog = mongoose.model<IMoodLog>('MoodLog', moodLogSchema);
