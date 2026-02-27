import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export interface IWaterLog extends Document {
  userId: mongoose.Types.ObjectId;
  amountOz: number;
  date: string;
  createdAt: Date;
  updatedAt: Date;
}

const waterLogSchema = new Schema<IWaterLog>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  amountOz: { type: Number, required: true },
  /** YYYY-MM-DD string for easy daily filtering */
  date: { type: String, required: true, index: true },
});

waterLogSchema.plugin(basePlugin);

export const WaterLog = mongoose.model<IWaterLog>('WaterLog', waterLogSchema);
