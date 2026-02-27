import mongoose, { Schema, type Document } from 'mongoose';

export interface IBakedScenery extends Document {
  farmCols: number;
  farmRows: number;
  imageUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

const bakedScenerySchema = new Schema<IBakedScenery>(
  {
    farmCols: { type: Number, required: true },
    farmRows: { type: Number, required: true },
    imageUrl: { type: String, required: true },
  },
  { timestamps: true },
);

bakedScenerySchema.index({ farmCols: 1, farmRows: 1 }, { unique: true });

export const BakedScenery = mongoose.model<IBakedScenery>('BakedScenery', bakedScenerySchema);
