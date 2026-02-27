import mongoose, { type Document, Schema, type Types } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

/** Extensible category for collectable items (bugs, fish, discoverables, etc.). */
export type CollectionCategory = 'bug' | 'fish' | 'discoverables';

export const COLLECTION_CATEGORIES: CollectionCategory[] = ['bug', 'fish', 'discoverables'];

export interface IUserCollection extends Document {
  userId: Types.ObjectId;
  /** Which collection this entry belongs to. */
  category: CollectionCategory;
  /** References GameItemDef.itemType — the specific item caught. */
  itemType: string;
  /** Rolled size for this individual catch (e.g. 0.5–2.0). */
  size: number;
  /** Gems awarded for this specific catch. */
  gemsAwarded: number;
  caughtAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userCollectionSchema = new Schema<IUserCollection>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  category: { type: String, required: true, enum: COLLECTION_CATEGORIES },
  itemType: { type: String, required: true },
  size: { type: Number, required: true },
  gemsAwarded: { type: Number, required: true, min: 0 },
  caughtAt: { type: Date, required: true, default: Date.now },
});

userCollectionSchema.index({ userId: 1, category: 1, caughtAt: -1 });
userCollectionSchema.index({ userId: 1, category: 1, itemType: 1 });

userCollectionSchema.plugin(basePlugin);

export const UserCollection = mongoose.model<IUserCollection>('UserCollection', userCollectionSchema);
