/**
 * Crafting recipes every new farm should already know (no scroll required).
 * Processed materials only — furniture and tools still come from quests / levels.
 */
export const STARTER_CRAFTING_RECIPE_IDS = [
  'wood_plank',
  'iron',
  'rope',
  'glass',
] as const;

export type StarterCraftingRecipeId = (typeof STARTER_CRAFTING_RECIPE_IDS)[number];
