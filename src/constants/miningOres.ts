/**
 * Scene mining overlay types + drop mapping.
 * Painted in the admin scene editor; tapped in-world with a pickaxe.
 */

export type MiningRarity =
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'very_rare'
  | 'legendary'
  | 'mythic';

export interface MiningOreDef {
  /** Admin / scene tile id. */
  id: string;
  label: string;
  rarity: MiningRarity;
  /** Inventory item granted on a successful mine. */
  dropItemType: string;
  emoji: string;
  color: string;
  /** Mini-game 1–5. 1 = 30 taps / 15s. */
  difficulty: number;
}

/** Difficulty 1 = 30 taps in 15s, then steeper. */
export function miningMinigameParams(difficulty: number): { tapsRequired: number; timeLimitMs: number } {
  const d = Math.max(1, Math.min(5, Math.round(difficulty)));
  return {
    tapsRequired: 30 + (d - 1) * 10,
    timeLimitMs: 15000 - (d - 1) * 1500,
  };
}

export const MINING_ORE_DEFS: readonly MiningOreDef[] = [
  // Basic stone
  { id: 'stone', label: 'Stone', rarity: 'common', dropItemType: 'stone', emoji: '🪨', color: '#8A8680', difficulty: 1 },
  { id: 'granite', label: 'Granite', rarity: 'common', dropItemType: 'granite', emoji: '🪨', color: '#6E6560', difficulty: 1 },
  { id: 'limestone', label: 'Limestone', rarity: 'common', dropItemType: 'limestone', emoji: '🪨', color: '#C9C2B0', difficulty: 1 },
  { id: 'slate', label: 'Slate', rarity: 'common', dropItemType: 'slate', emoji: '🪨', color: '#4A5560', difficulty: 1 },
  { id: 'sandstone', label: 'Sandstone', rarity: 'common', dropItemType: 'sandstone', emoji: '🪨', color: '#C4A574', difficulty: 1 },
  { id: 'flint', label: 'Flint', rarity: 'common', dropItemType: 'flint', emoji: '🪨', color: '#3D3D42', difficulty: 1 },
  { id: 'coal', label: 'Coal', rarity: 'common', dropItemType: 'coal', emoji: '⬛', color: '#2B2B2B', difficulty: 1 },
  { id: 'clay', label: 'Clay', rarity: 'common', dropItemType: 'clay', emoji: '🟤', color: '#A0522D', difficulty: 1 },
  // Metals
  { id: 'copper', label: 'Copper Ore', rarity: 'common', dropItemType: 'copper_ore', emoji: '🟠', color: '#B87333', difficulty: 2 },
  { id: 'tin', label: 'Tin Ore', rarity: 'common', dropItemType: 'tin_ore', emoji: '⚪', color: '#A8B4B8', difficulty: 2 },
  { id: 'iron', label: 'Iron Ore', rarity: 'common', dropItemType: 'iron_ore', emoji: '⚙️', color: '#7A5C45', difficulty: 2 },
  { id: 'zinc', label: 'Zinc Ore', rarity: 'uncommon', dropItemType: 'zinc_ore', emoji: '🔘', color: '#9AA3A7', difficulty: 3 },
  { id: 'lead', label: 'Lead Ore', rarity: 'uncommon', dropItemType: 'lead_ore', emoji: '⚫', color: '#4A4A52', difficulty: 3 },
  { id: 'nickel', label: 'Nickel Ore', rarity: 'uncommon', dropItemType: 'nickel_ore', emoji: '🪙', color: '#8F9A7A', difficulty: 3 },
  { id: 'silver', label: 'Silver Ore', rarity: 'rare', dropItemType: 'silver_ore', emoji: '🥈', color: '#C0C0C0', difficulty: 4 },
  { id: 'gold', label: 'Gold Ore', rarity: 'rare', dropItemType: 'gold_ore', emoji: '🥇', color: '#D4AF37', difficulty: 4 },
  { id: 'mithril', label: 'Mithril Ore', rarity: 'legendary', dropItemType: 'mithril_ore', emoji: '💠', color: '#7EC8E3', difficulty: 5 },
  // Gems
  { id: 'quartz', label: 'Quartz', rarity: 'uncommon', dropItemType: 'quartz', emoji: '💎', color: '#E8F0F5', difficulty: 3 },
  { id: 'garnet', label: 'Garnet', rarity: 'uncommon', dropItemType: 'garnet', emoji: '❤️', color: '#7B1E3A', difficulty: 3 },
  { id: 'amethyst', label: 'Amethyst', rarity: 'rare', dropItemType: 'amethyst', emoji: '💜', color: '#7B4B9A', difficulty: 4 },
  { id: 'emerald', label: 'Emerald', rarity: 'rare', dropItemType: 'emerald', emoji: '💚', color: '#2E8B57', difficulty: 4 },
  { id: 'ruby', label: 'Ruby', rarity: 'rare', dropItemType: 'ruby', emoji: '❤️', color: '#C41E3A', difficulty: 4 },
  { id: 'sapphire', label: 'Sapphire', rarity: 'rare', dropItemType: 'sapphire', emoji: '💙', color: '#0F52BA', difficulty: 4 },
  { id: 'topaz', label: 'Topaz', rarity: 'rare', dropItemType: 'topaz', emoji: '💛', color: '#E6B422', difficulty: 4 },
  { id: 'opal', label: 'Opal', rarity: 'rare', dropItemType: 'opal', emoji: '🌈', color: '#D9C4E8', difficulty: 4 },
  { id: 'jade', label: 'Jade', rarity: 'rare', dropItemType: 'jade', emoji: '🟢', color: '#00A86B', difficulty: 4 },
  { id: 'moonstone', label: 'Moonstone', rarity: 'very_rare', dropItemType: 'moonstone', emoji: '🌙', color: '#C5D5E8', difficulty: 5 },
  { id: 'sunstone', label: 'Sunstone', rarity: 'very_rare', dropItemType: 'sunstone', emoji: '☀️', color: '#F4A460', difficulty: 5 },
  { id: 'black_opal', label: 'Black Opal', rarity: 'very_rare', dropItemType: 'black_opal', emoji: '🖤', color: '#1A1028', difficulty: 5 },
  // Magical
  { id: 'star_crystal', label: 'Star Crystal', rarity: 'legendary', dropItemType: 'star_crystal', emoji: '⭐', color: '#F7E7A8', difficulty: 5 },
  { id: 'moon_crystal', label: 'Moon Crystal', rarity: 'legendary', dropItemType: 'moon_crystal', emoji: '🌕', color: '#8EC5E8', difficulty: 5 },
  { id: 'sun_crystal', label: 'Sun Crystal', rarity: 'legendary', dropItemType: 'sun_crystal', emoji: '🌞', color: '#FFD27A', difficulty: 5 },
  { id: 'aurora_crystal', label: 'Aurora Crystal', rarity: 'legendary', dropItemType: 'aurora_crystal', emoji: '🌌', color: '#7FFFD4', difficulty: 5 },
  { id: 'spirit_crystal', label: 'Spirit Crystal', rarity: 'legendary', dropItemType: 'spirit_crystal', emoji: '👻', color: '#F4F0FF', difficulty: 5 },
  { id: 'dream_crystal', label: 'Dream Crystal', rarity: 'legendary', dropItemType: 'dream_crystal', emoji: '💭', color: '#E0B0FF', difficulty: 5 },
  { id: 'void_crystal', label: 'Void Crystal', rarity: 'mythic', dropItemType: 'void_crystal', emoji: '🕳️', color: '#12081C', difficulty: 5 },
  { id: 'celestial', label: 'Celestial Ore', rarity: 'mythic', dropItemType: 'celestial_ore', emoji: '🌠', color: '#3D2B6B', difficulty: 5 },
  { id: 'etherstone', label: 'Etherstone', rarity: 'mythic', dropItemType: 'etherstone', emoji: '✨', color: '#B8C4FF', difficulty: 5 },
  { id: 'astralite', label: 'Astralite', rarity: 'mythic', dropItemType: 'astralite', emoji: '🪐', color: '#1B1B4A', difficulty: 5 },
];

export const MINING_ORE_TYPES = MINING_ORE_DEFS.map((d) => d.id);

export type MiningOreType = (typeof MINING_ORE_DEFS)[number]['id'];

const BY_ID = new Map(MINING_ORE_DEFS.map((d) => [d.id, d]));

export function isMiningOreType(value: string | undefined | null): value is MiningOreType {
  return !!value && BY_ID.has(value);
}

export function miningOreDef(oreType: string): MiningOreDef | undefined {
  return BY_ID.get(oreType);
}

export function oreDropItemType(oreType: MiningOreType): string {
  return BY_ID.get(oreType)?.dropItemType ?? `${oreType}_ore`;
}

export const ORE_LABELS: Record<string, string> = Object.fromEntries(
  MINING_ORE_DEFS.map((d) => [d.id, d.label]),
);

/** Refined metals smelted at the smelter. */
export const SMELTING_RECIPES: Array<{
  recipeId: string;
  label: string;
  resultItemType: string;
  ingredients: Array<{ itemType: string; qty: number }>;
  difficulty: number;
}> = [
  {
    recipeId: 'smelt_copper_ingot',
    label: 'Copper Ingot',
    resultItemType: 'copper_ingot',
    ingredients: [
      { itemType: 'copper_ore', qty: 2 },
      { itemType: 'coal', qty: 1 },
    ],
    difficulty: 1,
  },
  {
    recipeId: 'smelt_tin_ingot',
    label: 'Tin Ingot',
    resultItemType: 'tin_ingot',
    ingredients: [
      { itemType: 'tin_ore', qty: 2 },
      { itemType: 'coal', qty: 1 },
    ],
    difficulty: 1,
  },
  {
    recipeId: 'smelt_bronze_ingot',
    label: 'Bronze Ingot',
    resultItemType: 'bronze_ingot',
    ingredients: [
      { itemType: 'copper_ingot', qty: 1 },
      { itemType: 'tin_ingot', qty: 1 },
      { itemType: 'coal', qty: 1 },
    ],
    difficulty: 2,
  },
  {
    recipeId: 'smelt_iron_ingot',
    label: 'Iron Ingot',
    resultItemType: 'iron_ingot',
    ingredients: [
      { itemType: 'iron_ore', qty: 3 },
      { itemType: 'coal', qty: 1 },
    ],
    difficulty: 2,
  },
  {
    recipeId: 'smelt_steel_ingot',
    label: 'Steel Ingot',
    resultItemType: 'steel_ingot',
    ingredients: [
      { itemType: 'iron_ingot', qty: 1 },
      { itemType: 'coal', qty: 2 },
    ],
    difficulty: 3,
  },
  {
    recipeId: 'smelt_brass_ingot',
    label: 'Brass Ingot',
    resultItemType: 'brass_ingot',
    ingredients: [
      { itemType: 'copper_ingot', qty: 1 },
      { itemType: 'zinc_ore', qty: 1 },
      { itemType: 'coal', qty: 1 },
    ],
    difficulty: 3,
  },
  {
    recipeId: 'smelt_silver_ingot',
    label: 'Silver Ingot',
    resultItemType: 'silver_ingot',
    ingredients: [
      { itemType: 'silver_ore', qty: 2 },
      { itemType: 'coal', qty: 1 },
    ],
    difficulty: 4,
  },
  {
    recipeId: 'smelt_gold_ingot',
    label: 'Gold Ingot',
    resultItemType: 'gold_ingot',
    ingredients: [
      { itemType: 'gold_ore', qty: 2 },
      { itemType: 'coal', qty: 1 },
    ],
    difficulty: 5,
  },
];

export const INGOT_ITEM_TYPES = [
  'copper_ingot',
  'tin_ingot',
  'bronze_ingot',
  'iron_ingot',
  'steel_ingot',
  'silver_ingot',
  'gold_ingot',
  'brass_ingot',
] as const;
