import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

// ─── Interface ──────────────────────────────────────────────────────────────

export interface IAchievement extends Document {
  userId: mongoose.Types.ObjectId;
  /** Achievement key from the ACHIEVEMENTS registry (e.g. "FIRST_FOOD_LOG") */
  achievementId: string;
  /** When the achievement was unlocked */
  unlockedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Schema ─────────────────────────────────────────────────────────────────

const achievementSchema = new Schema<IAchievement>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  achievementId: { type: String, required: true },
  unlockedAt: { type: Date, default: Date.now },
});

// One user can only earn each achievement once
achievementSchema.index({ userId: 1, achievementId: 1 }, { unique: true });

achievementSchema.plugin(basePlugin);

export const Achievement = mongoose.model<IAchievement>('Achievement', achievementSchema);
