import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

/** Supported scheduled notification types. Extend when adding new kinds. */
export const SCHEDULED_NOTIFICATION_TYPES = ['pet_hunger'] as const;

export type ScheduledNotificationType = (typeof SCHEDULED_NOTIFICATION_TYPES)[number];

// ─── Interface ─────────────────────────────────────────────────────────────

export interface IScheduledNotificationLog extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  type: ScheduledNotificationType;
  sentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const schema = new Schema<IScheduledNotificationLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: SCHEDULED_NOTIFICATION_TYPES, required: true },
    sentAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

schema.plugin(basePlugin);
schema.index({ userId: 1, type: 1, sentAt: -1 });

export const ScheduledNotificationLog = mongoose.model<IScheduledNotificationLog>(
  'ScheduledNotificationLog',
  schema,
);

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Checks if we already sent this notification type to the user today (UTC).
 */
export async function wasSentToday(
  userId: string | mongoose.Types.ObjectId,
  type: ScheduledNotificationType,
): Promise<boolean> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const count = await ScheduledNotificationLog.countDocuments({
    userId: new mongoose.Types.ObjectId(String(userId)),
    type,
    sentAt: { $gte: start, $lt: end },
  });
  return count > 0;
}

/**
 * Records that we sent this notification type to the user.
 */
export async function recordSent(
  userId: string | mongoose.Types.ObjectId,
  type: ScheduledNotificationType,
): Promise<void> {
  await ScheduledNotificationLog.create({
    userId: new mongoose.Types.ObjectId(String(userId)),
    type,
    sentAt: new Date(),
  });
}
