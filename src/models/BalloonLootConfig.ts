import mongoose, { Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';
import type { BugRarity } from './GameItemDef.js';

export interface IBalloonLootEntry {
  itemType: string;
  rarity: BugRarity;
  weight?: number;
}

export interface IBalloonLootConfig extends mongoose.Document {
  entries: IBalloonLootEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const balloonLootEntrySchema = new Schema<IBalloonLootEntry>(
  {
    itemType: { type: String, required: true },
    rarity: { type: String, required: true, enum: ['common', 'rare', 'epic', 'unique', 'legendary', 'mythic'] },
    weight: { type: Number },
  },
  { _id: false },
);

const balloonLootConfigSchema = new Schema<IBalloonLootConfig>(
  {
    entries: { type: [balloonLootEntrySchema], default: [] },
  },
  { timestamps: true },
);

balloonLootConfigSchema.plugin(basePlugin);

export const BalloonLootConfig = mongoose.model<IBalloonLootConfig>('BalloonLootConfig', balloonLootConfigSchema);
