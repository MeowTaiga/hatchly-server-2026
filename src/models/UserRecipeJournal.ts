import mongoose, { type Document, Schema, type Types } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export interface IUserRecipeJournal extends Document {
  userId: Types.ObjectId;
  recipeId: string;
  discoveredAt: Date;
  timesCrafted: number;
  createdAt: Date;
  updatedAt: Date;
}

const userRecipeJournalSchema = new Schema<IUserRecipeJournal>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  recipeId: { type: String, required: true },
  discoveredAt: { type: Date, required: true, default: Date.now },
  timesCrafted: { type: Number, required: true, default: 1, min: 1 },
});

userRecipeJournalSchema.index({ userId: 1, recipeId: 1 }, { unique: true });

userRecipeJournalSchema.plugin(basePlugin);

export const UserRecipeJournal = mongoose.model<IUserRecipeJournal>('UserRecipeJournal', userRecipeJournalSchema);
