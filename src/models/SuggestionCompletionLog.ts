import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export interface ISuggestionCompletionLog extends Document {
  userId: mongoose.Types.ObjectId;
  /** YYYY-MM-DD for daily cap */
  date: string;
  /** Number of suggestion completions today (max 3) */
  count: number;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ISuggestionCompletionLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    date: { type: String, required: true, index: true },
    count: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

schema.plugin(basePlugin);
schema.index({ userId: 1, date: 1 }, { unique: true });

export const SuggestionCompletionLog = mongoose.model<ISuggestionCompletionLog>('SuggestionCompletionLog', schema);
