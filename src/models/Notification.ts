import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

/** Supported notification types. Extend when adding new kinds. */
export const NOTIFICATION_TYPES = [
  'friend_request',
  'friend_accepted',
  'fasting_complete',
  'goal_reminder',
  'marriage_proposal',
  'marriage_accepted',
  'shared_goal_complete',
  'shared_goal_added',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// ─── Interface ─────────────────────────────────────────────────────────────

export interface INotification extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  type: NotificationType;
  title: string;
  body?: string;
  /** Routing payload, e.g. { friendRequestId, fromUserId } */
  data?: Record<string, unknown>;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Schema ───────────────────────────────────────────────────────────────

const notificationSchema = new Schema<INotification>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      default: undefined,
    },
    data: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    readAt: {
      type: Date,
      default: undefined,
    },
  },
  { timestamps: true },
);

notificationSchema.plugin(basePlugin);

notificationSchema.index({ userId: 1 });
notificationSchema.index({ userId: 1, createdAt: -1 });

// ─── Model ───────────────────────────────────────────────────────────────

export const Notification = mongoose.model<INotification>('Notification', notificationSchema);
