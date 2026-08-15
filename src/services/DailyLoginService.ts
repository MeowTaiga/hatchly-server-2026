import { type IPlacedItem } from '../models/Farm.js';
import { DailyLoginReward } from '../models/DailyLoginReward.js';
import { User } from '../models/User.js';
import { farmService } from './FarmService.js';
import {
  appendFossilHoles,
  DAILY_FOSSIL_HOLE_COUNT,
  FOSSIL_HOLE_ITEM_TYPE,
  spawnDailyGroundPickupsForUser,
} from './GroundPickupService.js';
import { advanceTreeGrowth } from './TreeService.js';
import { getTodayDateStr, getYesterdaySummary } from '../utils/getYesterdaySummary.js';
import { getDailyGreeting } from './PetGreetingService.js';
import { appendPetMessage } from './PetChatService.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('DailyLoginService');

function dateStrInTz(date: Date, timezone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function countUndugFossilHoles(placedItems: readonly IPlacedItem[]): number {
  return placedItems.filter(
    (i) => i.itemType === FOSSIL_HOLE_ITEM_TYPE && !i.anchorId,
  ).length;
}

/**
 * Checks if user has already received today's rewards. If not, places fossil holes +
 * daily ground pickups (stones/sticks), generates AI greeting, records the reward.
 */
export async function checkAndGrant(userId: string, timezone?: string): Promise<{ greeting?: string }> {
  const today = getTodayDateStr(timezone);

  const existing = await DailyLoginReward.findOne({ userId, date: today });
  if (existing) {
    return {};
  }

  const user = await User.findById(userId).lean();
  if (!user) return {};

  // Ensure farm exists (create path seeds stones/sticks + dig spots for day 0).
  const farm = await farmService.loadOrCreateFarm(userId);
  const createdToday = dateStrInTz(farm.createdAt, timezone) === today;

  // Day-0 farms already got dig spots in loadOrCreateFarm. Returning players get
  // a fresh pair each calendar day. Skip on create-day so reset/new farms don't
  // end up with four holes when daily-login also fires.
  if (!createdToday) {
    const undugBefore = countUndugFossilHoles(farm.placedItems);
    const { gridCols, gridRows } = await farmService.getGridDimensions(userId);
    const { items, placed } = await appendFossilHoles(
      farm.placedItems,
      gridCols,
      gridRows,
      DAILY_FOSSIL_HOLE_COUNT,
    );
    if (placed > 0) {
      farm.placedItems = items;
      farm.markModified('placedItems');
      await farm.save();
    }
    log.info({ userId, placed, undugBefore }, 'Daily fossil holes placed');
  } else {
    log.info({ userId }, 'Skipping daily fossil holes — day-0 farm already seeded dig spots');
  }

  try {
    // Refresh stones/sticks to today's counts (clears leftovers, then re-places).
    await spawnDailyGroundPickupsForUser(userId);
  } catch (err) {
    log.warn({ userId, err }, 'Failed to spawn daily ground pickups');
  }

  const yesterdaySummary = await getYesterdaySummary(userId, timezone);
  const petState = {
    hunger: user.pet?.hunger ?? 100,
    happy: user.pet?.happy ?? 100,
    mood: user.pet?.mood ?? 100,
    customName: user.pet?.customName,
    name: user.pet?.name,
  };
  const greeting = await getDailyGreeting(userId, yesterdaySummary, petState);
  if (greeting) await appendPetMessage(userId, greeting);

  await DailyLoginReward.create({
    userId,
    date: today,
    rewardedAt: new Date(),
  });

  await advanceTreeGrowth(userId, timezone);

  log.info({ userId }, 'Daily login rewards granted');
  return { greeting };
}
