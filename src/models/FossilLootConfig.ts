import mongoose, { Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';
import type { BugRarity } from './GameItemDef.js';

export interface IFossilLootEntry {
  itemType: string;
  rarity: BugRarity;
  weight?: number;
}

export interface IFossilLootConfig extends mongoose.Document {
  entries: IFossilLootEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const fossilLootEntrySchema = new Schema<IFossilLootEntry>(
  {
    itemType: { type: String, required: true },
    rarity: { type: String, required: true, enum: ['common', 'rare', 'epic', 'unique', 'legendary', 'mythic'] },
    weight: { type: Number },
  },
  { _id: false },
);

const fossilLootConfigSchema = new Schema<IFossilLootConfig>(
  {
    entries: { type: [fossilLootEntrySchema], default: [] },
  },
  { timestamps: true },
);

fossilLootConfigSchema.plugin(basePlugin);

export const FossilLootConfig = mongoose.model<IFossilLootConfig>('FossilLootConfig', fossilLootConfigSchema);
