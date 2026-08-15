import mongoose from 'mongoose';
import { Expo } from 'expo-server-sdk';
import { env } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { PushToken } from '../models/PushToken.js';

const log = createLogger('PushService');

/**
 * Sends push notifications via the Expo Push Service.
 *
 * Uses expo-server-sdk which handles batching, retries, and delivery
 * to FCM (Android) and APNs (iOS). DeviceNotRegistered is handled
 * by removing invalid tokens when we process receipts (future enhancement).
 *
 * Exported as a singleton instance (`pushService`).
 */
class PushService {
  private expo: Expo;

  constructor() {
    this.expo = new Expo({
      accessToken: process.env.EXPO_ACCESS_TOKEN,
      useFcmV1: true,
    });
    log.info('PushService initialised');
  }

  /**
   * Sends a push notification to all devices registered for the given user.
   *
   * @param userId — The recipient's user ID (string or ObjectId)
   * @param message — { title, body?, data? } — Expo message format
   * @returns Number of messages queued (0 if no tokens)
   */
  async sendToUser(
    userId: string,
    message: { title: string; body?: string; data?: Record<string, unknown> },
  ): Promise<number> {
    const tokens = await PushToken.find({ userId: new mongoose.Types.ObjectId(userId) })
      .select('token')
      .lean();
    const validTokens: string[] = [];

    for (const row of tokens) {
      const raw = String(row.token);
      // Not `if (isExpoPushToken(raw))`: the guard's type is a branded string,
      // so the else branch narrows `raw` to never and we couldn't log it.
      const valid: boolean = Expo.isExpoPushToken(raw);
      if (valid) validTokens.push(raw);
      else log.warn({ userId, token: raw.slice(0, 30) }, 'Invalid Expo push token, skipping');
    }

    if (validTokens.length === 0) {
      log.debug({ userId }, 'No valid push tokens for user');
      return 0;
    }

    const messages = validTokens.map((token) => ({
      to: token,
      sound: 'default' as const,
      title: message.title,
      body: message.body ?? '',
      data: message.data ?? {},
    }));

    try {
      const chunks = this.expo.chunkPushNotifications(messages);

      for (const chunk of chunks) {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i];
          if (ticket?.status === 'error') {
            log.warn(
              { userId, error: ticket.message, token: validTokens[i]?.slice(0, 30) },
              'Push ticket error',
            );
            // DeviceNotRegistered appears in push receipts, not tickets — handle via receipts in future
          }
        }
      }

      log.info({ userId, count: messages.length }, 'Push notifications sent');
      return messages.length;
    } catch (err: unknown) {
      log.error({ userId, err }, 'Failed to send push notifications');
      throw err;
    }
  }
}

/** Singleton — import this, don't instantiate the class directly */
export const pushService = new PushService();
