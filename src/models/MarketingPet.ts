import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export interface IMarketingPet extends Document {
  name: string;
  vibe: string;
  category: string;
  baseColor: string;
  secondaryColor: string;
  /** Original standing / default generation */
  baseImageUrl?: string;
  /** Display image — usually a random pose */
  imageUrl: string;
  poseKey?: string;
  sortOrder: number;
  active: boolean;
}

const marketingPetSchema = new Schema<IMarketingPet>({
  name: { type: String, required: true, trim: true },
  vibe: { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true },
  baseColor: { type: String, required: true },
  secondaryColor: { type: String, required: true },
  baseImageUrl: { type: String },
  imageUrl: { type: String, required: true },
  poseKey: { type: String, default: 'happy' },
  sortOrder: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
});

marketingPetSchema.index({ name: 1, vibe: 1 }, { unique: true });
marketingPetSchema.plugin(basePlugin);

export const MarketingPet = mongoose.model<IMarketingPet>('MarketingPet', marketingPetSchema);
