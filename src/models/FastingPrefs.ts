import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

/**
 * One-time fasting opt-in. Missing doc = the user has not answered yet.
 */
export interface IFastingPrefs extends Document {
  userId: mongoose.Types.ObjectId;
  interested: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const fastingPrefsSchema = new Schema<IFastingPrefs>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  interested: { type: Boolean, required: true },
});

fastingPrefsSchema.plugin(basePlugin);

export const FastingPrefs = mongoose.model<IFastingPrefs>('FastingPrefs', fastingPrefsSchema);
