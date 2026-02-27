import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

// ─── Interface ───────────────────────────────────────────────────────────────

export interface IFriend extends Document {
  _id: mongoose.Types.ObjectId;
  fromUserId: mongoose.Types.ObjectId;
  toUserId: mongoose.Types.ObjectId;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: Date;
  updatedAt: Date;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const friendSchema = new Schema<IFriend>(
  {
    fromUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    toUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      required: true,
      default: 'pending',
    },
  },
  { timestamps: true },
);

friendSchema.plugin(basePlugin);

friendSchema.index({ fromUserId: 1, toUserId: 1 }, { unique: true });
friendSchema.index({ toUserId: 1 });
friendSchema.index({ status: 1 });

// ─── Model ───────────────────────────────────────────────────────────────────

export const Friend = mongoose.model<IFriend>('Friend', friendSchema);
