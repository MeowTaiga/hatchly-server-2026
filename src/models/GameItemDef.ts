import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';
import type { IDialogStep } from './QuestDef.js';

export interface IHarvestDrop {
  itemType: string;
  qty: number;
}

/** Defines what happens when a user taps a placed item outside of edit mode. */
export type InteractActionType = 'open_scene' | 'open_modal' | 'start_dialog' | 'none';

export interface IInteractAction {
  type: InteractActionType;
  /** Scene name, modal id, dialog key, etc. */
  payload?: string;
}

/** The 6 unique fence shapes — rotated on the client to produce all 16 bitmask variants. */
export type FenceVariant = 'post' | 'end' | 'straight' | 'corner' | 'tJunction' | 'cross';

export interface IDirectionalImages {
  post?: string;
  end?: string;
  straight?: string;
  corner?: string;
  tJunction?: string;
  cross?: string;
}

export type ItemCategory =
  | 'seed' | 'decoration' | 'ingredient' | 'building' | 'scenery'
  | 'flooring' | 'tiled_flooring' | 'fish' | 'bug' | 'equip' | 'soil' | 'food' | 'material' | 'asset'
  | 'npc' | 'tree';

export const ITEM_CATEGORIES: ItemCategory[] = [
  'seed', 'decoration', 'ingredient', 'building', 'scenery',
  'flooring', 'tiled_flooring', 'fish', 'bug', 'equip', 'soil', 'food', 'material', 'asset',
  'npc', 'tree',
];

export type BugRarity = 'common' | 'rare' | 'epic' | 'unique' | 'legendary' | 'mythic';

export const BUG_RARITIES: BugRarity[] = [
  'common', 'rare', 'epic', 'unique', 'legendary', 'mythic',
];

export type BugActiveTime = 'all_day' | 'night' | 'morning' | 'afternoon';

export const BUG_ACTIVE_TIMES: BugActiveTime[] = [
  'all_day', 'night', 'morning', 'afternoon',
];

export interface IGameItemDef extends Document {
  itemType: string;
  label: string;
  emoji: string;
  color: string;
  imageUrl?: string;
  category: ItemCategory;
  /** Sub-category for pet AI interactions, e.g. 'pet_bed' → pet walks there to sleep */
  subCategory?: string;
  placeable: boolean;
  cols: number;
  rows: number;
  growthMs?: number;
  harvestYield: IHarvestDrop[];
  interactAction?: IInteractAction;
  /** When true, adjacent items of the same type auto-connect using directionalImages. */
  autoConnect: boolean;
  /** When true, item is centered in its tile and overflows upward (garden arch, houses, grown crops). */
  centerOverflow?: boolean;
  /** Image URLs for each fence shape (populated when autoConnect is true). */
  directionalImages?: IDirectionalImages;
  /** Whether this item can be purchased in the shop. */
  buyable: boolean;
  /** Gem cost to purchase one of this item from the shop. */
  gemPrice: number;
  /** Minimum farm level required to purchase this item. */
  farmLevel?: number;
  /** Minimum pet level required to purchase this item. */
  petLevel?: number;
  /** Shop section key (e.g. 'seasonal', 'easter') — item appears in this section. */
  shopSection?: string;
  /** Whether this item can be sold back to the shop for gems. */
  sellable?: boolean;
  /** Gems awarded per item when sold. Undefined = use category-based default. */
  sellPrice?: number;
  /** When set, item is only available until this date (timer). */
  availableUntil?: Date;
  /** Gems awarded when this crop is harvested (seed-specific) or base gem reward for bugs. */
  gemsGiven?: number;
  /** Minimum rolled size when this bug is caught (bug-specific). */
  bugSizeMin?: number;
  /** Maximum rolled size when this bug is caught (bug-specific). */
  bugSizeMax?: number;
  /** Rarity tier for this bug — affects spawn weight and gem multiplier. */
  bugRarity?: BugRarity;
  /** Time of day when this bug can spawn. */
  bugActiveTime?: BugActiveTime;
  /** SubCategories this bug spawns on. Empty/undefined = spawn anywhere. */
  bugSpawnOn?: string[];
  /** Scene slugs this bug can spawn in. Empty/undefined = all scenes. */
  bugScenes?: string[];
  /** Minimum rolled size when this fish is caught (fish-specific). */
  fishSizeMin?: number;
  /** Maximum rolled size when this fish is caught (fish-specific). */
  fishSizeMax?: number;
  /** Rarity tier for this fish — affects spawn weight and gem multiplier. */
  fishRarity?: BugRarity;
  /** Time of day when this fish can spawn. */
  fishActiveTime?: BugActiveTime;
  /** Spot types (river, ocean, pond, general) where this fish can be caught. Empty/undefined = all spots. */
  fishSpotTypes?: string[];
  /** Light emission radius in tiles (e.g. 3 = 3 tiles around the item). */
  lightRadius?: number;
  /** Hex color of the emitted light (e.g. '#FFDD88'). */
  lightColor?: string;
  /** Base opacity/intensity of the glow (0.1 - 1.0). */
  lightIntensity?: number;
  /** Hunger restored when fed to pet (0-100). Food category only. */
  foodHunger?: number;
  /** Happiness restored when fed to pet (0-100). Food category only. */
  foodHappiness?: number;
  /** XP given to pet when consumed. Food category only. */
  foodPetXp?: number;
  /** Buff type key for future extensibility (e.g. 'speed', 'luck'). */
  foodBuffType?: string;
  /** Duration of the buff in milliseconds. */
  foodBuffDurationMs?: number;
  /** Dialog steps shown when user taps NPC (subCategory 'npc'). Uses item label + imageUrl as speaker. */
  npcDialog?: IDialogStep[];
  /** For fully grown trees: itemType of fruit this tree produces (e.g. 'apple'). Items with subCategory 'fruit'. */
  treeFruit?: string;
  /** For fruit items (subCategory 'fruit'): tree variant slugs this fruit can grow on (e.g. ['oak', 'dark_oak']). */
  growsOnTrees?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const harvestDropSchema = new Schema<IHarvestDrop>(
  {
    itemType: { type: String, required: true },
    qty: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const npcDialogHighlightSchema = new Schema(
  {
    type: { type: String, required: true, enum: ['hud_button', 'inventory_item', 'world_item', 'category_chip', 'shop_item', 'shop_category'] },
    target: { type: String, required: true },
  },
  { _id: false },
);

const npcDialogStepSchema = new Schema(
  {
    text: { type: String, required: true },
    highlight: { type: npcDialogHighlightSchema },
  },
  { _id: false },
);

const gameItemDefSchema = new Schema<IGameItemDef>({
  itemType: { type: String, required: true, unique: true, index: true },
  label: { type: String, required: true },
  emoji: { type: String, default: '📦' },
  color: { type: String, required: true },
  imageUrl: { type: String },
  category: {
    type: String,
    required: true,
    enum: ITEM_CATEGORIES,
  },
  subCategory: { type: String, default: undefined },
  placeable: { type: Boolean, required: true, default: false },
  cols: { type: Number, required: true, default: 1, min: 1 },
  rows: { type: Number, required: true, default: 1, min: 1 },
  growthMs: { type: Number },
  harvestYield: { type: [harvestDropSchema], default: [] },
  interactAction: {
    type: new Schema(
      {
        type: { type: String, enum: ['open_scene', 'open_modal', 'start_dialog', 'none'], required: true },
        payload: { type: String },
      },
      { _id: false },
    ),
  },
  autoConnect: { type: Boolean, default: false },
  centerOverflow: { type: Boolean, default: false },
  directionalImages: {
    type: new Schema(
      {
        post: { type: String },
        end: { type: String },
        straight: { type: String },
        corner: { type: String },
        tJunction: { type: String },
        cross: { type: String },
      },
      { _id: false },
    ),
  },
  buyable: { type: Boolean, default: false },
  gemPrice: { type: Number, default: 0, min: 0 },
  farmLevel: { type: Number, default: undefined, min: 0 },
  petLevel: { type: Number, default: undefined, min: 0 },
  shopSection: { type: String, default: undefined },
  sellable: { type: Boolean, default: false },
  sellPrice: { type: Number, default: undefined, min: 0 },
  availableUntil: { type: Date, default: undefined },
  gemsGiven: { type: Number, default: undefined, min: 0 },
  bugSizeMin: { type: Number, default: undefined, min: 0.1 },
  bugSizeMax: { type: Number, default: undefined, min: 0.1 },
  bugRarity: { type: String, enum: BUG_RARITIES, default: 'common' },
  bugActiveTime: { type: String, enum: BUG_ACTIVE_TIMES, default: 'all_day' },
  bugSpawnOn: { type: [String], default: undefined },
  bugScenes: { type: [String], default: undefined },
  fishSizeMin: { type: Number, default: undefined, min: 0.1 },
  fishSizeMax: { type: Number, default: undefined, min: 0.1 },
  fishRarity: { type: String, enum: BUG_RARITIES, default: 'common' },
  fishActiveTime: { type: String, enum: BUG_ACTIVE_TIMES, default: 'all_day' },
  fishSpotTypes: { type: [String], default: undefined },
  lightRadius: { type: Number, default: undefined, min: 0.5 },
  lightColor: { type: String, default: undefined },
  lightIntensity: { type: Number, default: undefined, min: 0.1, max: 1 },
  foodHunger: { type: Number, default: undefined, min: 0, max: 100 },
  foodHappiness: { type: Number, default: undefined, min: 0, max: 100 },
  foodPetXp: { type: Number, default: undefined, min: 0 },
  foodBuffType: { type: String, default: undefined },
  foodBuffDurationMs: { type: Number, default: undefined, min: 0 },
  npcDialog: { type: [npcDialogStepSchema], default: undefined },
  treeFruit: { type: String, default: undefined },
  growsOnTrees: { type: [String], default: undefined },
});

gameItemDefSchema.plugin(basePlugin);

export const GameItemDef = mongoose.model<IGameItemDef>('GameItemDef', gameItemDefSchema);
