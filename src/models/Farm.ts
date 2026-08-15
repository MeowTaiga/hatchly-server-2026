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
  /** For trees: YYYY-MM-DD when planted or last growth stage advanced. Used for daily growth. */
  treePlantedDate?: string;
  /** For fully grown fruit trees: 0–3 fruit currently on tree. Reset to 0 after harvest. */
  treeFruitCount?: number;
  /** For fruit trees: YYYY-MM-DD when fruit was last harvested. Fruit regrows after 3 days. */
  fruitLastHarvestedDate?: string;
  /** Calendar day (YYYY-MM-DD) of the last axe chop. */
  woodChopDate?: string;
  /** Axe chops used on woodChopDate (max 3 per tree per day). */
  woodChopCount?: number;
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
  /**
   * The farm's level, raised only by completing that level's farm_upgrade quest.
   * Stored rather than derived: it used to be recovered by regexing the level
   * number out of quest ids, and three code paths each parsed it differently,
   * which is why nobody could get past level 1.
   */
  farmLevel: number;
  gems: number;
  inventory: Map<string, number>;
  /**
   * Farm-wide vault (uncapped). Opened via placed `storage` items.
   * Distinct from backpack (`inventory`), which is slot-capped.
   */
  storage: Map<string, number>;
  /** Max distinct item stacks in backpack. Defaults to BASE_BACKPACK_SLOTS (20). */
  backpackSlots?: number;
  /**
   * Highest farming level for which soil skill-milestones have already been granted.
   * Prevents re-granting on catch-up / reconnect.
   */
  farmingSoilGrantedThroughLevel?: number;
  placedItems: IPlacedItem[];
  equipped?: IEquipped;
  /** Food dish queues keyed by anchorId. Each value is FIFO queue of itemTypes. */
  foodDishQueues?: FoodDishQueues;
  /** Optional pet spawn position (tiles). If unset, uses defaults (8, 12). */
  petSpawnCol?: number;
  petSpawnRow?: number;
  /** Last time user collected water from any well; used for 5min cooldown. */
  lastWellCollectAt?: Date;
  /** Current mining stamina (regen 1 / 10 min, capped by mining skill). */
  miningEnergy?: number;
  /** Timestamp when `miningEnergy` was last accurate (regen clock). */
  miningEnergyAt?: Date;
  /** Last Spirit Snatch attempt (hourly). Set when a round starts. */
  lastSpiritSnatchAt?: Date;
  /** In-progress Spirit Snatch spawn list. Cleared on submit or expiry. */
  spiritSnatchRound?: {
    roundId: string;
    startedAt: Date;
    targets: {
      id: number;
      kind: 'treat' | 'trick';
      xFrac: number;
      spawnAt: number;
      fallMs: number;
      driftFrac: number;
    }[];
  };
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
    treePlantedDate: { type: String },
    treeFruitCount: { type: Number },
    fruitLastHarvestedDate: { type: String },
    woodChopDate: { type: String },
    woodChopCount: { type: Number },
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
  farmLevel: { type: Number, default: 1, min: 1 },
  gems: { type: Number, default: 10, min: 0 },
  inventory: { type: Map, of: Number, default: {} },
  storage: { type: Map, of: Number, default: {} },
  backpackSlots: { type: Number, default: undefined, min: 1 },
  farmingSoilGrantedThroughLevel: { type: Number, default: 0, min: 0 },
  placedItems: { type: [placedItemSchema], default: [] },
  equipped: { type: equippedSchema, default: {} },
  foodDishQueues: { type: Schema.Types.Mixed, default: {} },
  petSpawnCol: { type: Number },
  petSpawnRow: { type: Number },
  lastWellCollectAt: { type: Date },
  miningEnergy: { type: Number, min: 0 },
  miningEnergyAt: { type: Date },
  lastSpiritSnatchAt: { type: Date },
  spiritSnatchRound: { type: Schema.Types.Mixed },
});

farmSchema.plugin(basePlugin);

export const Farm = mongoose.model<IFarm>('Farm', farmSchema);
