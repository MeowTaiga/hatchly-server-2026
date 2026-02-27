import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export interface IUserProgress extends Document {
  userId: mongoose.Types.ObjectId;
  /** Scene slugs the user has visited (for enter_scene quest triggers). */
  visitedScenes: string[];
  createdAt: Date;
  updatedAt: Date;
}

const userProgressSchema = new Schema<IUserProgress>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    visitedScenes: { type: [String], default: [] },
  },
  { timestamps: true },
);

userProgressSchema.plugin(basePlugin);

export const UserProgress = mongoose.model<IUserProgress>('UserProgress', userProgressSchema);
