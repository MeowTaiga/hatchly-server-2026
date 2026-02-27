import { Types } from 'mongoose';
import { Farm } from '../models/Farm.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { BalloonLootConfig } from '../models/BalloonLootConfig.js';
import { SuggestionCompletionLog } from '../models/SuggestionCompletionLog.js';
import { PetChat } from '../models/PetChat.js';
import { farmService } from './FarmService.js';
import { getTodayDateStr } from '../utils/getYesterdaySummary.js';
import { RARITY_WEIGHTS, weightedPick } from '../utils/rarity.js';
import { createLogger } from '../config/logger.js';
import { AppError } from '../middleware/errorHandler.js';

const log = createLogger('SuggestionRewardService');

const DAILY_CAP = 3;
const GEMS_MIN = 2;
const GEMS_MAX = 5;

export interface SuggestionRewardResult {
  gemsAwarded: number;
  item?: { itemType: string; label: string; imageUrl?: string; emoji?: string; qty: number };
  limitReached: boolean;
}

/**
 * Grants reward for completing a pet suggestion. Max 3 per day.
 * Picks random item from balloon loot, awards gems.
 */
export async function grantSuggestionReward(
  userId: string,
  messageId: string,
  timezone?: string,
): Promise<SuggestionRewardResult> {
  const today = getTodayDateStr(timezone);
  const userIdObj = new Types.ObjectId(userId);

  const chatDoc = await PetChat.findOne({ userId: userIdObj }).lean();
  const msg = chatDoc?.messages?.find((m: any) => String(m._id ?? m.id ?? '') === messageId);
  if (!msg?.suggest) throw new AppError('Invalid or unknown suggestion', 400, 'INVALID_SUGGESTION');

  const existing = await SuggestionCompletionLog.findOne({ userId: userIdObj, date: today }).lean();
  const currentCount = existing?.count ?? 0;
  if (currentCount >= DAILY_CAP) {
    return { gemsAwarded: 0, limitReached: true };
  }

  await SuggestionCompletionLog.findOneAndUpdate(
    { userId: userIdObj, date: today },
    { $inc: { count: 1 } },
    { upsert: true },
  );

  const config = await BalloonLootConfig.findOne().lean();
  const entries = config?.entries ?? [];
  const validItemTypes = new Set((await GameItemDef.find().lean()).map((d) => d.itemType));
  const eligible = entries.filter((e) => validItemTypes.has(e.itemType));

  const gemsAwarded = GEMS_MIN + Math.floor(Math.random() * (GEMS_MAX - GEMS_MIN + 1));
  let itemResult: SuggestionRewardResult['item'] | undefined;

  if (eligible.length > 0) {
    const picked = weightedPick(eligible, (e) => e.weight ?? RARITY_WEIGHTS[e.rarity as keyof typeof RARITY_WEIGHTS]);
    const def = await GameItemDef.findOne({ itemType: picked.itemType }).lean();
    itemResult = {
      itemType: picked.itemType,
      label: def?.label ?? picked.itemType,
      imageUrl: def?.imageUrl,
      emoji: def?.emoji,
      qty: 1,
    };

    const farm = await Farm.findOne({ userId: userIdObj });
    if (farm) {
      const current = farm.inventory.get(picked.itemType) ?? 0;
      farm.inventory.set(picked.itemType, current + 1);
      farm.markModified('inventory');
      farm.gems = (farm.gems ?? 0) + gemsAwarded;
      await farm.save();
    }
  } else {
    const farm = await farmService.loadOrCreateFarm(userId);
    farm.gems = (farm.gems ?? 0) + gemsAwarded;
    await farm.save();
  }

  log.info({ userId, messageId, gemsAwarded, itemType: itemResult?.itemType }, 'Suggestion reward granted');
  return { gemsAwarded, item: itemResult, limitReached: false };
}
