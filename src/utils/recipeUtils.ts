/**
 * Shared recipe helpers used by CookingService and CraftingService.
 */

export interface RecipeIngredientInput {
  itemType: string;
  qty: number;
}

export function normalizeIngredients(ingredients: RecipeIngredientInput[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const ing of ingredients) {
    map.set(ing.itemType, (map.get(ing.itemType) ?? 0) + ing.qty);
  }
  return map;
}

export function ingredientsMatch(
  recipeIngredients: { itemType: string; qty: number }[],
  provided: Map<string, number>,
): boolean {
  const recipeMap = new Map<string, number>();
  for (const ri of recipeIngredients) {
    recipeMap.set(ri.itemType, (recipeMap.get(ri.itemType) ?? 0) + ri.qty);
  }
  if (recipeMap.size !== provided.size) return false;
  for (const [itemType, qty] of recipeMap) {
    if (provided.get(itemType) !== qty) return false;
  }
  return true;
}

/**
 * Finds the maximum batch factor for a recipe given provided ingredients.
 * Normalizes recipe ingredients (sums qty per itemType), then for each computes
 * Math.floor(provided / recipeQty). Returns the minimum across ingredients.
 *
 * @param recipeIngredients - Recipe ingredients (may have duplicates per itemType)
 * @param provided - Map of itemType → quantity provided
 * @returns Maximum valid batch count (0 if cannot make any)
 */
export function findBatchFactor(
  recipeIngredients: { itemType: string; qty: number }[],
  provided: Map<string, number>,
): number {
  const recipeMap = new Map<string, number>();
  for (const ri of recipeIngredients) {
    recipeMap.set(ri.itemType, (recipeMap.get(ri.itemType) ?? 0) + ri.qty);
  }
  if (recipeMap.size === 0) return 0;
  let minFactor = Infinity;
  for (const [itemType, recipeQty] of recipeMap) {
    if (recipeQty <= 0) continue;
    const providedQty = provided.get(itemType) ?? 0;
    const factor = Math.floor(providedQty / recipeQty);
    minFactor = Math.min(minFactor, factor);
  }
  return minFactor === Infinity ? 0 : Math.max(0, minFactor);
}

/**
 * Validates that provided ingredients satisfy recipe × batchFactor.
 * Normalizes recipe ingredients (sums qty per itemType) before checking.
 *
 * @param recipeIngredients - Recipe ingredients (may have duplicates per itemType)
 * @param provided - Map of itemType → quantity provided
 * @param batchFactor - Batch multiplier to validate
 * @returns true if provided >= recipe × batchFactor for every ingredient
 */
export function ingredientsMatchBatch(
  recipeIngredients: { itemType: string; qty: number }[],
  provided: Map<string, number>,
  batchFactor: number,
): boolean {
  if (batchFactor < 1) return false;
  const recipeMap = new Map<string, number>();
  for (const ri of recipeIngredients) {
    recipeMap.set(ri.itemType, (recipeMap.get(ri.itemType) ?? 0) + ri.qty);
  }
  for (const [itemType, recipeQty] of recipeMap) {
    const required = recipeQty * batchFactor;
    const have = provided.get(itemType) ?? 0;
    if (have < required) return false;
  }
  return true;
}

export function inventoryToRecord(map: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of map) {
    if (v > 0) out[k] = v;
  }
  return out;
}
