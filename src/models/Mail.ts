import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export interface IAttachedItem {
  itemType: string;
  qty: number;
}

export interface IMail extends Document {
  /** Sender (null = admin/system) */
  fromUserId: mongoose.Types.ObjectId | null;
  /** Recipient (null = broadcast to all) */
  toUserId: mongoose.Types.ObjectId | null;
  /** Subject line */
  subject: string;
  /** Body text */
  body: string;
  /** Items attached; claimed when mail is opened */
  attachedItems: IAttachedItem[];
  /** When the mail was sent (UTC) */
  sentAt: Date;
  /** Whether recipient has claimed (opened) the mail and received attached items */
  claimedAt?: Date;
  /** Admin broadcast: sent to all users */
  isBroadcast: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const attachedItemSchema = new Schema<IAttachedItem>(
  {
    itemType: { type: String, required: true },
    qty: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const mailSchema = new Schema<IMail>(
  {
    fromUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    toUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    subject: { type: String, required: true, maxlength: 200 },
    body: { type: String, required: true, maxlength: 2000 },
    attachedItems: { type: [attachedItemSchema], default: [] },
    sentAt: { type: Date, required: true, default: Date.now },
    claimedAt: { type: Date },
    isBroadcast: { type: Boolean, default: false },
  },
  { timestamps: true },
);

mailSchema.plugin(basePlugin);

mailSchema.index({ toUserId: 1, sentAt: -1 });
mailSchema.index({ fromUserId: 1, sentAt: -1 });
mailSchema.index({ isBroadcast: 1, sentAt: -1 });

export const Mail = mongoose.model<IMail>('Mail', mailSchema);
