import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

/** Tracks petting interactions for rate limiting (e.g. 3 per hour). */
export interface IPetPetLog extends Document {
  userId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IPetPetLog>(
  { userId: { type: Schema.Types.ObjectId, ref: 'User', required: true } },
  { timestamps: true },
);
schema.index({ userId: 1, createdAt: -1 });
schema.plugin(basePlugin);

export const PetPetLog = mongoose.model<IPetPetLog>('PetPetLog', schema);
