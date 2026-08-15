import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export const MARRIAGE_STATUSES = ['pending', 'married'] as const;
export type MarriageStatus = (typeof MARRIAGE_STATUSES)[number];

export interface IMarriage extends Document {
  userLow: mongoose.Types.ObjectId;
  userHigh: mongoose.Types.ObjectId;
  proposedBy: mongoose.Types.ObjectId;
  status: MarriageStatus;
  createdAt: Date;
  updatedAt: Date;
}

const marriageSchema = new Schema<IMarriage>({
  userLow: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  userHigh: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  proposedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, required: true, enum: MARRIAGE_STATUSES, default: 'pending' },
});

marriageSchema.index({ userLow: 1, userHigh: 1 }, { unique: true });
marriageSchema.plugin(basePlugin);

export const Marriage = mongoose.model<IMarriage>('Marriage', marriageSchema);

export function marriagePair(
  a: string,
  b: string,
): { userLow: mongoose.Types.ObjectId; userHigh: mongoose.Types.ObjectId } {
  const [low, high] = a < b ? [a, b] : [b, a];
  return {
    userLow: new mongoose.Types.ObjectId(low),
    userHigh: new mongoose.Types.ObjectId(high),
  };
}

export function otherSpouse(doc: { userLow: mongoose.Types.ObjectId; userHigh: mongoose.Types.ObjectId }, userId: string): string {
  const low = String(doc.userLow);
  return low === userId ? String(doc.userHigh) : low;
}
