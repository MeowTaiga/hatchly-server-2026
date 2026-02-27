import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export interface IPlacedItem {
  id: string;
  itemType: string;
  col: number;
  row: number;
  tileCols: number;
  tileRows: number;
  anchorId?: string;
  plantedAt?: Date;
  growthMs?: number;
  /** Whether this seed/crop has been watered. Growth only starts after watering. */
  watered?: boolean;
}

export interface IEquipped {
  handTool?: string;
  bobber?: string;
  bait?: string;
  chair?: string;
}

/** Queue of food itemTypes per food_dish anchorId (FIFO). */
export type FoodDishQueues = Record<string, string[]>;

export interface IFarm extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  xp: number;
  gems: number;
  inventory: Map<string, number>;
  placedItems: IPlacedItem[];
  equipped?: IEquipped;
  /** Food dish queues keyed by anchorId. Each value is FIFO queue of itemTypes. */
  foodDishQueues?: FoodDishQueues;
  /** Optional pet spawn position (tiles). If unset, uses defaults (8, 12). */
  petSpawnCol?: number;
  petSpawnRow?: number;
  /** Last time user collected water from any well; used for 5min cooldown. */
  lastWellCollectAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const placedItemSchema = new Schema<IPlacedItem>(
  {
    id: { type: String, required: true },
    itemType: { type: String, required: true },
    col: { type: Number, required: true },
    row: { type: Number, required: true },
    tileCols: { type: Number, required: true, default: 1 },
    tileRows: { type: Number, required: true, default: 1 },
    anchorId: { type: String },
    plantedAt: { type: Date },
    growthMs: { type: Number },
    watered: { type: Boolean },
  },
  { _id: false },
);

const equippedSchema = new Schema<IEquipped>(
  {
    handTool: { type: String },
    bobber: { type: String },
    bait: { type: String },
    chair: { type: String },
  },
  { _id: false },
);

const farmSchema = new Schema<IFarm>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  name: { type: String, default: 'My Farm', maxlength: 24 },
  xp: { type: Number, default: 0, min: 0 },
  gems: { type: Number, default: 10, min: 0 },
  inventory: { type: Map, of: Number, default: {} },
  placedItems: { type: [placedItemSchema], default: [] },
  equipped: { type: equippedSchema, default: {} },
  foodDishQueues: { type: Schema.Types.Mixed, default: {} },
  petSpawnCol: { type: Number },
  petSpawnRow: { type: Number },
  lastWellCollectAt: { type: Date },
});

farmSchema.plugin(basePlugin);

export const Farm = mongoose.model<IFarm>('Farm', farmSchema);
