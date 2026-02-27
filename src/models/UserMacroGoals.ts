import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export interface IUserMacroGoals extends Document {
  userId: mongoose.Types.ObjectId;
  protein?: number;
  fat?: number;
  saturatedFat?: number;
  transFat?: number;
  carbs?: number;
  sugar?: number;
  addedSugars?: number;
  fiber?: number;
  sodium?: number;
  potassium?: number;
  cholesterol?: number;
  iron?: number;
  calcium?: number;
  vitaminA?: number;
  vitaminC?: number;
  vitaminD?: number;
  createdAt: Date;
  updatedAt: Date;
}

const userMacroGoalsSchema = new Schema<IUserMacroGoals>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  protein: { type: Number },
  fat: { type: Number },
  saturatedFat: { type: Number },
  transFat: { type: Number },
  carbs: { type: Number },
  sugar: { type: Number },
  addedSugars: { type: Number },
  fiber: { type: Number },
  sodium: { type: Number },
  potassium: { type: Number },
  cholesterol: { type: Number },
  iron: { type: Number },
  calcium: { type: Number },
  vitaminA: { type: Number },
  vitaminC: { type: Number },
  vitaminD: { type: Number },
});
userMacroGoalsSchema.plugin(basePlugin);

export const UserMacroGoals = mongoose.model<IUserMacroGoals>('UserMacroGoals', userMacroGoalsSchema);
