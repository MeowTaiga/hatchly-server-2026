import mongoose from 'mongoose';
import { Mail, type IMail, type IAttachedItem } from '../models/Mail.js';
import { Farm } from '../models/Farm.js';
import { User } from '../models/User.js';
import { Friend } from '../models/Friend.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('MailService');

/** Mail delivery time (3am local) */
const DELIVERY_HOUR = 3;
const DELIVERY_MINUTE = 0;

/**
 * Mail sent on day D delivers at 3am on day D+1 in the recipient's timezone.
 */
function getDeliveryMoment(sentAt: Date, timezone: string): Date {
  const sentLocal = new Date(sentAt.toLocaleString('en-US', { timeZone: timezone }));
  const sentDate = new Date(sentLocal.getFullYear(), sentLocal.getMonth(), sentLocal.getDate());
  const nextDay = new Date(sentDate);
  nextDay.setDate(nextDay.getDate() + 1);
  return new Date(nextDay.getTime() + DELIVERY_HOUR * 60 * 60 * 1000 + DELIVERY_MINUTE * 60 * 1000);
}

function isDelivered(sentAt: Date, timezone: string): boolean {
  const deliveryMoment = getDeliveryMoment(sentAt, timezone);
  const nowLocal = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
  return nowLocal >= deliveryMoment;
}

export const mailService = {
  /**
   * Send mail from one user to a friend.
   */
  async sendToFriend(
    fromUserId: string,
    toUserId: string,
    subject: string,
    body: string,
    attachedItems: IAttachedItem[],
  ): Promise<IMail> {
    const fromUser = await User.findById(fromUserId).lean();
    if (!fromUser) throw new Error('Sender not found');

    const from = new mongoose.Types.ObjectId(fromUserId);
    const to = new mongoose.Types.ObjectId(toUserId);
    const areFriends = await Friend.findOne({
      status: 'accepted',
      $or: [
        { fromUserId: from, toUserId: to },
        { fromUserId: to, toUserId: from },
      ],
    }).lean();
    if (!areFriends) throw new Error('Can only send mail to friends');

    await this.validateAttachedItems(fromUserId, attachedItems);
    await this.consumeAttachedItems(fromUserId, attachedItems);

    const mail = await Mail.create({
      fromUserId,
      toUserId,
      subject,
      body,
      attachedItems,
      sentAt: new Date(),
      isBroadcast: false,
    });
    log.info({ fromUserId, toUserId, subject: subject.slice(0, 30) }, 'Mail sent to friend');
    return mail;
  },

  /**
   * Admin: send mail to a specific user.
   */
  /**
   * Admin sends to a specific user. Attached items are granted (not consumed from admin).
   */
  async sendToUser(
    fromUserId: string,
    toUserId: string,
    subject: string,
    body: string,
    attachedItems: IAttachedItem[],
  ): Promise<IMail> {
    if (attachedItems?.length) await this.validateAttachedItemTypes(attachedItems);

    const mail = await Mail.create({
      fromUserId,
      toUserId,
      subject,
      body,
      attachedItems,
      sentAt: new Date(),
      isBroadcast: false,
    });
    log.info({ fromUserId, toUserId, subject: subject.slice(0, 30) }, 'Admin mail sent to user');
    return mail;
  },

  /**
   * Admin: send mail to all users (broadcast).
   */
  /**
   * Admin broadcasts to all users. Attached items are granted (not consumed from admin).
   */
  async sendBroadcast(
    fromUserId: string,
    subject: string,
    body: string,
    attachedItems: IAttachedItem[],
  ): Promise<IMail> {
    if (attachedItems?.length) await this.validateAttachedItemTypes(attachedItems);

    const mail = await Mail.create({
      fromUserId,
      toUserId: null,
      subject,
      body,
      attachedItems,
      sentAt: new Date(),
      isBroadcast: true,
    });
    log.info({ fromUserId, subject: subject.slice(0, 30) }, 'Admin broadcast mail sent');
    return mail;
  },

  /**
   * List delivered mail for a user (inbox).
   */
  async listInbox(userId: string): Promise<Array<Record<string, unknown> & { _id: unknown; fromUsername?: string; isDelivered: boolean }>> {
    const user = await User.findById(userId).select('timezone').lean();
    const timezone = user?.timezone ?? 'UTC';

    const [directMail, broadcastMail] = await Promise.all([
      Mail.find({ toUserId: userId, isBroadcast: false })
        .sort({ sentAt: -1 })
        .limit(50)
        .populate('fromUserId', 'username')
        .lean(),
      Mail.find({ isBroadcast: true }).sort({ sentAt: -1 }).limit(50).populate('fromUserId', 'username').lean(),
    ]);

    const all = [...directMail, ...broadcastMail];
    all.sort((a, b) => (b.sentAt as Date).getTime() - (a.sentAt as Date).getTime());

    return all
      .map((m) => {
        const delivered = isDelivered(m.sentAt as Date, timezone);
        const from = m.fromUserId as { username?: string } | null;
        return {
          ...m,
          fromUsername: from?.username ?? 'Admin',
          isDelivered: delivered,
        };
      })
      .filter((m) => m.isDelivered);
  },

  /**
   * Claim mail: mark as claimed and add attached items to recipient's inventory.
   */
  async claimMail(userId: string, mailId: string): Promise<{ success: boolean; inventory?: Record<string, number> }> {
    const mail = await Mail.findById(mailId).lean();
    if (!mail) throw new Error('Mail not found');

    if (mail.toUserId && mail.toUserId.toString() !== userId) {
      throw new Error('Cannot claim mail for another user');
    }
    if (!mail.toUserId && !mail.isBroadcast) throw new Error('Invalid mail');

    const user = await User.findById(userId).select('timezone').lean();
    const timezone = user?.timezone ?? 'UTC';
    if (!isDelivered(mail.sentAt as Date, timezone)) {
      throw new Error('Mail not yet delivered');
    }

    if (mail.claimedAt) {
      return { success: false };
    }

    await Mail.updateOne({ _id: mailId }, { $set: { claimedAt: new Date() } });

    if (mail.attachedItems?.length) {
      const farm = await Farm.findOne({ userId });
      if (farm) {
        for (const { itemType, qty } of mail.attachedItems) {
          const current = farm.inventory.get(itemType) ?? 0;
          farm.inventory.set(itemType, current + qty);
        }
        farm.markModified('inventory');
        await farm.save();

        const inv: Record<string, number> = {};
        for (const [k, v] of farm.inventory) if (v > 0) inv[k] = v;
        return { success: true, inventory: inv };
      }
    }

    return { success: true };
  },

  /** Validate item types exist and admin can grant them (no inventory check). */
  async validateAttachedItemTypes(items: IAttachedItem[]): Promise<void> {
    if (!items?.length) return;
    const defs = await GameItemDef.find({ itemType: { $in: items.map((i) => i.itemType) } }).lean();
    const defMap = new Map(defs.map((d) => [d.itemType, d]));
    for (const { itemType, qty } of items) {
      if (qty < 1) throw new Error(`Invalid quantity for ${itemType}`);
      if (!defMap.get(itemType)) throw new Error(`Unknown item: ${itemType}`);
    }
  },

  async validateAttachedItems(userId: string, items: IAttachedItem[]): Promise<void> {
    if (!items?.length) return;
    const defs = await GameItemDef.find({ itemType: { $in: items.map((i) => i.itemType) } }).lean();
    const defMap = new Map(defs.map((d) => [d.itemType, d]));
    const farm = await Farm.findOne({ userId });
    if (!farm) throw new Error('No farm to attach items from');

    for (const { itemType, qty } of items) {
      if (qty < 1) throw new Error(`Invalid quantity for ${itemType}`);
      const def = defMap.get(itemType);
      if (!def) throw new Error(`Unknown item: ${itemType}`);
      const have = farm.inventory.get(itemType) ?? 0;
      if (have < qty) throw new Error(`Not enough ${itemType} (have ${have}, need ${qty})`);
    }
  },

  /**
   * Consume attached items from sender's inventory when sending.
   */
  async consumeAttachedItems(userId: string, items: IAttachedItem[]): Promise<void> {
    if (!items?.length) return;
    const farm = await Farm.findOne({ userId });
    if (!farm) throw new Error('No farm');

    for (const { itemType, qty } of items) {
      const current = farm.inventory.get(itemType) ?? 0;
      const next = current - qty;
      if (next <= 0) farm.inventory.delete(itemType);
      else farm.inventory.set(itemType, next);
    }
    farm.markModified('inventory');
    await farm.save();
  },
};
