import mongoose from 'mongoose';
import { createLogger } from '../config/logger.js';
import { Notification, type NotificationType } from '../models/Notification.js';
import { User } from '../models/User.js';
import { emitToUser } from '../websocket/index.js';
import { WS_EVENTS } from '../websocket/events.js';
import { pushService } from './PushService.js';

const log = createLogger('NotificationService');

/** Payload for creating a notification. Data shape varies by type. */
export interface CreateNotificationPayload {
  friendRequestId?: string;
  fromUserId?: string;
  fromUsername?: string;
}

/** API response shape for a single notification */
export interface NotificationPayload {
  id: string;
  type: NotificationType;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  readAt?: string;
  createdAt: string;
}

/**
 * Builds title and body for a notification type.
 *
 * @param type — Notification type
 * @param payload — Type-specific data (e.g. fromUsername for friend_request)
 */
function toTitleBody(type: NotificationType, payload: CreateNotificationPayload): { title: string; body: string } {
  switch (type) {
    case 'friend_request':
      return {
        title: 'Friend request',
        body: `${payload.fromUsername ?? 'Someone'} wants to be your friend`,
      };
    case 'friend_accepted':
      return {
        title: 'Friend request accepted',
        body: `${payload.fromUsername ?? 'Someone'} accepted your friend request`,
      };
    default:
      return { title: 'Notification', body: '' };
  }
}

/**
 * Handles creating, persisting, and delivering notifications.
 *
 * Single entry point `createAndDeliver` ensures every notification is:
 * 1. Stored in the DB
 * 2. Emitted via WebSocket (real-time in-app)
 * 3. Sent via push (when app is backgrounded)
 *
 * Exported as a singleton instance (`notificationService`).
 */
class NotificationService {
  /**
   * Creates a notification document only. Use `createAndDeliver` for the full flow.
   *
   * @param userId — Recipient user ID
   * @param type — Notification type
   * @param payload — Type-specific data
   * @returns The created notification (lean)
   */
  async create(
    userId: string,
    type: NotificationType,
    payload: CreateNotificationPayload,
  ): Promise<{ _id: mongoose.Types.ObjectId; type: NotificationType; title: string; body?: string; data?: Record<string, unknown>; readAt?: Date; createdAt: Date }> {
    const { title, body } = toTitleBody(type, payload);
    const data: Record<string, unknown> = {};
    if (payload.friendRequestId) data.friendRequestId = payload.friendRequestId;
    if (payload.fromUserId) data.fromUserId = payload.fromUserId;

    const doc = await Notification.create({
      userId: new mongoose.Types.ObjectId(userId),
      type,
      title,
      body,
      data: Object.keys(data).length ? data : undefined,
    });

    return doc.toObject();
  }

  /**
   * Creates a notification and delivers it via WebSocket and push.
   *
   * @param userId — Recipient user ID
   * @param type — Notification type
   * @param payload — Type-specific data (fromUsername, etc.)
   * @returns The created notification payload for API response
   */
  async createAndDeliver(
    userId: string,
    type: NotificationType,
    payload: CreateNotificationPayload,
  ): Promise<NotificationPayload> {
    const doc = await this.create(userId, type, payload);
    const { title, body } = toTitleBody(type, payload);
    const id = (doc as { id?: string }).id ?? (doc as { _id?: mongoose.Types.ObjectId })._id?.toString() ?? '';
    const data: Record<string, unknown> = { ...(doc.data ?? {}) };
    data.id = id;
    data.type = type;

    emitToUser(userId, WS_EVENTS.NOTIFICATION, {
      id,
      type: doc.type,
      title: doc.title,
      body: doc.body,
      data: data,
      readAt: doc.readAt,
      createdAt: doc.createdAt,
    });

    pushService.sendToUser(userId, { title, body, data }).catch((err) => {
      log.warn({ userId, type, err }, 'Push delivery failed (non-fatal)');
    });

    return {
      id,
      type: doc.type,
      title: doc.title,
      body: doc.body,
      data: doc.data as Record<string, unknown>,
      readAt: doc.readAt?.toISOString(),
      createdAt: doc.createdAt?.toISOString(),
    };
  }

  /**
   * Marks a notification as read. Verifies ownership.
   *
   * @param notificationId — Notification ID
   * @param userId — Requester (must own the notification)
   */
  async markRead(notificationId: string, userId: string): Promise<void> {
    const result = await Notification.updateOne(
      { _id: new mongoose.Types.ObjectId(notificationId), userId: new mongoose.Types.ObjectId(userId) },
      { $set: { readAt: new Date() } },
    );
    if (result.matchedCount === 0) {
      log.warn({ notificationId, userId }, 'Notification not found or not owned');
    }
  }

  /**
   * Marks all notifications for a user as read.
   *
   * @param userId — User ID
   */
  async markAllRead(userId: string): Promise<void> {
    await Notification.updateMany(
      { userId: new mongoose.Types.ObjectId(userId), readAt: { $exists: false } },
      { $set: { readAt: new Date() } },
    );
  }

  /**
   * Fetches paginated notifications for a user.
   *
   * @param userId — User ID
   * @param options — { limit?, before? } — cursor-based pagination
   * @returns { notifications, unreadCount, hasMore }
   */
  async getForUser(
    userId: string,
    options: { limit?: number; before?: string } = {},
  ): Promise<{ notifications: NotificationPayload[]; unreadCount: number; hasMore: boolean }> {
    const limit = Math.min(options.limit ?? 20, 50);
    const query: Record<string, unknown> = { userId: new mongoose.Types.ObjectId(userId) };

    if (options.before) {
      const beforeDoc = await Notification.findById(options.before);
      if (beforeDoc?.createdAt) {
        query.createdAt = { $lt: beforeDoc.createdAt };
      }
    }

    const [notifications, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .limit(limit + 1)
        .lean(),
      Notification.countDocuments({ userId: new mongoose.Types.ObjectId(userId), readAt: { $exists: false } }),
    ]);

    const hasMore = notifications.length > limit;
    const slice = hasMore ? notifications.slice(0, limit) : notifications;

    return {
      notifications: slice.map((n) => ({
        id: n._id.toString(),
        type: n.type as NotificationType,
        title: n.title,
        body: n.body,
        data: n.data as Record<string, unknown>,
        readAt: n.readAt?.toISOString(),
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount,
      hasMore,
    };
  }
}

/** Singleton — import this, don't instantiate the class directly */
export const notificationService = new NotificationService();
