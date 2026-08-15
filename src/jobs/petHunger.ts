import { User } from '../models/User.js';
import { wasSentToday, recordSent } from '../models/ScheduledNotificationLog.js';
import { pushService } from '../services/PushService.js';
import { appendPetMessage } from '../services/PetChatService.js';
import { emitToUser, isUserConnected } from '../websocket/index.js';
import { WS_EVENTS } from '../websocket/events.js';
import {
  HUNGER_THRESHOLD,
  HUNGER_DEPLETION_AMOUNT,
} from '../config/scheduler.js';
import { pickHungerMessage } from '../constants/petHungerMessages.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('PetHunger');

/**
 * Depletes hunger from all pets. Runs every 7.5 minutes (~33% slower than the old 5‑min cadence).
 * - All users (connected or offline): deplete hunger.
 * - We do NOT consume from the food dish. Food is only consumed when the user is
 *   in-game and the Pet AI walks the pet to the bowl (client emits GAME_CONSUME_FROM_FOOD_DISH).
 */
export async function runHungerDepletion(): Promise<void> {
  const users = await User.find({
    status: 'active',
    pet: { $exists: true },
    'pet.hunger': { $gt: 0 },
  })
    .select('_id')
    .lean();

  const userIdsToDeplete = users.map((u) => String(u._id));

  if (userIdsToDeplete.length > 0) {
    const result = await User.updateMany(
      { _id: { $in: userIdsToDeplete } },
      { $inc: { 'pet.hunger': -HUNGER_DEPLETION_AMOUNT } },
    );
    log.debug({ modifiedCount: result.modifiedCount }, 'Hunger depletion run');
  }
}

/**
 * Notifies users with hungry pets. Runs every hour.
 * If connected: emit pet:dialog via WebSocket. If offline: push notification.
 * One per user per day max.
 */
export async function runHungerNotification(): Promise<void> {
  const users = await User.find({
    status: 'active',
    pet: { $exists: true },
    'pet.hunger': { $lt: HUNGER_THRESHOLD },
  })
    .select('_id username pet')
    .lean();

  for (const user of users) {
    const userId = String(user._id);
    const pet = user.pet;
    if (!pet) continue;

    try {
      if (await wasSentToday(userId, 'pet_hunger')) continue;

      const username = user.username ?? 'Friend';
      const message = pickHungerMessage(username, pet.customName);

      if (isUserConnected(userId)) {
        emitToUser(userId, WS_EVENTS.PET_DIALOG, { text: message });
        log.debug({ userId }, 'Hunger dialog emitted via WebSocket');
      } else {
        const sent = await pushService.sendToUser(userId, {
          title: message,
          data: { type: 'pet_hunger' },
        });
        if (sent > 0) log.debug({ userId }, 'Hunger push sent');
      }

      await appendPetMessage(userId, message);
      await recordSent(userId, 'pet_hunger');
    } catch (err) {
      log.error({ err, userId }, 'Hunger notification failed for user');
    }
  }
}
