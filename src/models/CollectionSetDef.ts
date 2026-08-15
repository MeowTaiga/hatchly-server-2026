import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export type CollectionSetCategory = 'fish' | 'bug';

export const COLLECTION_SET_CATEGORIES: CollectionSetCategory[] = ['fish', 'bug'];

export interface ICollectionSetDef extends Document {
  setId: string;
  label: string;
  category: CollectionSetCategory;
  itemTypes: string[];
  sortOrder: number;
  emoji?: string;
  description?: string;
  /** Reserved for future claim rewards — unused in v1. */
  rewards?: {
    gems?: number;
    xp?: number;
    items?: { itemType: string; qty: number }[];
  };
  createdAt: Date;
  updatedAt: Date;
}

const collectionSetDefSchema = new Schema<ICollectionSetDef>({
  setId: { type: String, required: true, unique: true },
  label: { type: String, required: true },
  category: { type: String, required: true, enum: COLLECTION_SET_CATEGORIES },
  itemTypes: { type: [String], required: true, default: [] },
  sortOrder: { type: Number, required: true, default: 0 },
  emoji: { type: String, default: undefined },
  description: { type: String, default: undefined },
  rewards: {
    type: new Schema(
      {
        gems: { type: Number, min: 0 },
        xp: { type: Number, min: 0 },
        items: {
          type: [
            new Schema(
              {
                itemType: { type: String, required: true },
                qty: { type: Number, required: true, min: 1 },
              },
              { _id: false },
            ),
          ],
          default: undefined,
        },
      },
      { _id: false },
    ),
    default: undefined,
  },
});

collectionSetDefSchema.index({ category: 1, sortOrder: 1 });

collectionSetDefSchema.plugin(basePlugin);

export const CollectionSetDef = mongoose.model<ICollectionSetDef>(
  'CollectionSetDef',
  collectionSetDefSchema,
);
