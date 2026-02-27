import { type IPlacedItem } from '../models/Farm.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { DailyLoginReward } from '../models/DailyLoginReward.js';
import { User } from '../models/User.js';
import { farmService } from './FarmService.js';
import { getTodayDateStr, getYesterdaySummary } from '../utils/getYesterdaySummary.js';
import { getDailyGreeting } from './PetGreetingService.js';
import { appendPetMessage } from './PetChatService.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('DailyLoginService');

const FOSSIL_HOLE_COUNT = 2;

/**
 * Finds empty grid slots for fossil placement. Prefers interior tiles (excludes edges);
 * falls back to any empty tile if no interior slots exist. Returns up to `count`
 * slots chosen randomly.
 */
function findEmptyGridSlots(placedItems: IPlacedItem[], gridCols: number, gridRows: number, count: number): { col: number; row: number }[] {
  const occupied = new Set<string>();
  for (const item of placedItems) {
    occupied.add(`${item.col}:${item.row}`);
  }

  const isEdge = (col: number, row: number) =>
    col === 0 || col === gridCols - 1 || row === 0 || row === gridRows - 1;

  const interior: { col: number; row: number }[] = [];
  const allEmpty: { col: number; row: number }[] = [];

  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      if (occupied.has(`${col}:${row}`)) continue;
      allEmpty.push({ col, row });
      if (!isEdge(col, row)) interior.push({ col, row });
    }
  }

  const candidates = interior.length >= count ? interior : allEmpty;

  // Fisher–Yates shuffle, then take first `count`
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, count);
}

/**
 * Checks if user has already received today's rewards. If not, places 2 fossil_holes on farm,
 * generates AI greeting from yesterday's data, records the reward, and returns the greeting.
 */
export async function checkAndGrant(userId: string, timezone?: string): Promise<{ greeting?: string }> {
  const today = getTodayDateStr(timezone);

  const existing = await DailyLoginReward.findOne({ userId, date: today });
  if (existing) {
    return {};
  }

  const user = await User.findById(userId).lean();
  if (!user) return {};

  const farm = await farmService.loadOrCreateFarm(userId);
  const fossilDef = await GameItemDef.findOne({ itemType: 'fossil_hole' }).lean();
  if (!fossilDef || !fossilDef.placeable) {
    log.warn({ userId }, 'fossil_hole not found or not placeable, skipping daily reward');
    return {};
  }

  const { gridCols, gridRows } = await farmService.getGridDimensions(userId);
  const slots = findEmptyGridSlots(farm.placedItems, gridCols, gridRows, FOSSIL_HOLE_COUNT);
  if (slots.length === 0) {
    log.info({ userId }, 'No empty slots for fossil holes, skipping placement');
  } else {
    const currentQty = farm.inventory.get('fossil_hole') ?? 0;
    farm.inventory.set('fossil_hole', currentQty + FOSSIL_HOLE_COUNT);
    farm.markModified('inventory');
    await farm.save();

    for (const slot of slots) {
      try {
        await farmService.placeItem(userId, 'fossil_hole', slot.col, slot.row);
      } catch (err) {
        log.warn({ userId, slot, err }, 'Failed to place fossil_hole');
      }
    }
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

  log.info({ userId }, 'Daily login rewards granted');
  return { greeting };
}
