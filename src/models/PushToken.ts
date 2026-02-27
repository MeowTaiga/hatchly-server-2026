import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

// ─── Interface ─────────────────────────────────────────────────────────────

export interface IPushToken extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  /** Expo push token (ExponentPushToken[xxx]) */
  token: string;
  platform?: 'ios' | 'android';
  createdAt: Date;
  updatedAt: Date;
}

// ─── Schema ───────────────────────────────────────────────────────────────

const pushTokenSchema = new Schema<IPushToken>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    token: {
      type: String,
      required: true,
      trim: true,
    },
    platform: {
      type: String,
      enum: ['ios', 'android'],
      default: undefined,
    },
  },
  { timestamps: true },
);

pushTokenSchema.plugin(basePlugin);

pushTokenSchema.index({ userId: 1, token: 1 }, { unique: true });
pushTokenSchema.index({ userId: 1 });

// ─── Model ───────────────────────────────────────────────────────────────

export const PushToken = mongoose.model<IPushToken>('PushToken', pushTokenSchema);
