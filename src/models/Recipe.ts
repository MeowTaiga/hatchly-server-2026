import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export interface IRecipeIngredient {
  itemType: string;
  qty: number;
}

export type RecipeType = 'cooking' | 'crafting' | 'smelting';

export interface IRecipe extends Document {
  recipeId: string;
  label: string;
  resultItemType: string;
  resultQty: number;
  ingredients: IRecipeIngredient[];
  /** 1-5 — controls mini-game difficulty (needle speed / pattern length). */
  difficulty: number;
  /** Distinguishes cooking recipes from crafting recipes. */
  recipeType: RecipeType;
  /**
   * Inventory item that unlocks this recipe (e.g. recipe_wood_plank / recipe_bread).
   */
  recipeItemType?: string;
  /** Cooking UI tab group: processing | baking | sandwich | bakery | salad | soup | dessert | drink */
  group?: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const recipeIngredientSchema = new Schema<IRecipeIngredient>(
  {
    itemType: { type: String, required: true },
    qty: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const recipeSchema = new Schema<IRecipe>({
  recipeId: { type: String, required: true, unique: true, index: true },
  label: { type: String, required: true },
  resultItemType: { type: String, required: true },
  resultQty: { type: Number, required: true, default: 1, min: 1 },
  ingredients: { type: [recipeIngredientSchema], required: true, validate: [(v: any[]) => v.length >= 1 && v.length <= 4, 'Recipes must have 1-4 ingredients'] },
  difficulty: { type: Number, required: true, default: 1, min: 1, max: 5 },
  recipeType: { type: String, enum: ['cooking', 'crafting', 'smelting'], default: 'cooking' },
  recipeItemType: { type: String, default: undefined },
  group: { type: String, default: undefined },
  sortOrder: { type: Number, default: 0 },
});

recipeSchema.plugin(basePlugin);

export const Recipe = mongoose.model<IRecipe>('GameRecipe', recipeSchema);
