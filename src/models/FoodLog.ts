import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

// ─── Meal Type ──────────────────────────────────────────────────────────────

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

// ─── Food Log ───────────────────────────────────────────────────────────────

export interface IFoodLog extends Document {
  userId: mongoose.Types.ObjectId;
  foodId: string;
  foodName: string;
  brandName?: string;
  servingDescription: string;
  numberOfServings: number;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  /** Extended macros from FatSecret (grams) */
  sugar?: number;
  fiber?: number;
  saturatedFat?: number;
  transFat?: number;
  addedSugars?: number;
  /** Minerals (mg) */
  sodium?: number;
  potassium?: number;
  cholesterol?: number;
  /** Micronutrients from FatSecret */
  iron?: number;
  calcium?: number;
  vitaminA?: number;
  vitaminC?: number;
  vitaminD?: number;
  mealType: MealType;
  /** Client-local YYYY-MM-DD string for timezone-safe daily filtering */
  date?: string;
  loggedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const foodLogSchema = new Schema<IFoodLog>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  foodId: { type: String, required: true },
  foodName: { type: String, required: true },
  brandName: { type: String },
  servingDescription: { type: String, required: true },
  numberOfServings: { type: Number, required: true, default: 1 },
  calories: { type: Number, required: true },
  protein: { type: Number, default: 0 },
  fat: { type: Number, default: 0 },
  carbs: { type: Number, default: 0 },
  sugar: { type: Number, default: 0 },
  fiber: { type: Number, default: 0 },
  saturatedFat: { type: Number, default: 0 },
  transFat: { type: Number, default: 0 },
  addedSugars: { type: Number, default: 0 },
  sodium: { type: Number, default: 0 },
  potassium: { type: Number, default: 0 },
  cholesterol: { type: Number, default: 0 },
  iron: { type: Number, default: 0 },
  calcium: { type: Number, default: 0 },
  vitaminA: { type: Number, default: 0 },
  vitaminC: { type: Number, default: 0 },
  vitaminD: { type: Number, default: 0 },
  mealType: { type: String, enum: MEAL_TYPES, required: true },
  date: { type: String, index: true },
  loggedAt: { type: Date, default: Date.now, index: true },
});

foodLogSchema.plugin(basePlugin);

export const FoodLog = mongoose.model<IFoodLog>('FoodLog', foodLogSchema);

// ─── Recipe Ingredient Sub-Document ─────────────────────────────────────────

export interface IRecipeIngredient {
  foodId: string;
  foodName: string;
  servingDescription: string;
  numberOfServings: number;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  sugar?: number;
  fiber?: number;
  saturatedFat?: number;
  transFat?: number;
  addedSugars?: number;
  sodium?: number;
  potassium?: number;
  cholesterol?: number;
  iron?: number;
  calcium?: number;
  vitaminA?: number;
  vitaminC?: number;
  vitaminD?: number;
}

const ingredientSchema = new Schema<IRecipeIngredient>(
  {
    foodId: { type: String, required: true },
    foodName: { type: String, required: true },
    servingDescription: { type: String, required: true },
    numberOfServings: { type: Number, required: true },
    calories: { type: Number, required: true },
    protein: { type: Number, default: 0 },
    fat: { type: Number, default: 0 },
    carbs: { type: Number, default: 0 },
    sugar: { type: Number, default: 0 },
    fiber: { type: Number, default: 0 },
    saturatedFat: { type: Number, default: 0 },
    transFat: { type: Number, default: 0 },
    addedSugars: { type: Number, default: 0 },
    sodium: { type: Number, default: 0 },
    potassium: { type: Number, default: 0 },
    cholesterol: { type: Number, default: 0 },
    iron: { type: Number, default: 0 },
    calcium: { type: Number, default: 0 },
    vitaminA: { type: Number, default: 0 },
    vitaminC: { type: Number, default: 0 },
    vitaminD: { type: Number, default: 0 },
  },
  { _id: false },
);

// ─── Recipe ─────────────────────────────────────────────────────────────────

export interface IRecipe extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  ingredients: IRecipeIngredient[];
  totalCalories: number;
  totalProtein: number;
  totalFat: number;
  totalCarbs: number;
  totalSugar: number;
  totalFiber: number;
  totalSodium: number;
  totalPotassium: number;
  totalIron: number;
  totalCalcium: number;
  totalVitaminA: number;
  totalVitaminC: number;
  totalVitaminD: number;
  servings: number;
  createdAt: Date;
  updatedAt: Date;
}

const recipeSchema = new Schema<IRecipe>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true },
  ingredients: { type: [ingredientSchema], required: true },
  totalCalories: { type: Number, required: true },
  totalProtein: { type: Number, default: 0 },
  totalFat: { type: Number, default: 0 },
  totalCarbs: { type: Number, default: 0 },
  totalSugar: { type: Number, default: 0 },
  totalFiber: { type: Number, default: 0 },
  totalSodium: { type: Number, default: 0 },
  totalPotassium: { type: Number, default: 0 },
  totalIron: { type: Number, default: 0 },
  totalCalcium: { type: Number, default: 0 },
  totalVitaminA: { type: Number, default: 0 },
  totalVitaminC: { type: Number, default: 0 },
  totalVitaminD: { type: Number, default: 0 },
  servings: { type: Number, required: true, default: 1 },
});

recipeSchema.plugin(basePlugin);

export const Recipe = mongoose.model<IRecipe>('Recipe', recipeSchema);
