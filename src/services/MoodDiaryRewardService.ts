import { Types } from 'mongoose';
import { Farm } from '../models/Farm.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { BalloonLootConfig } from '../models/BalloonLootConfig.js';
import { MoodLog } from '../models/MoodLog.js';
import { farmService } from './FarmService.js';
import { petService, type PublicPet } from './PetService.js';
import { SKILL_XP_REWARDS } from '../constants/skills.js';
import { RARITY_WEIGHTS, weightedPick } from '../utils/rarity.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('MoodDiaryRewardService');

/** How often a mood diary entry can grant rewards. */
export const MOOD_REWARD_COOLDOWN_MS = 3 * 60 * 60 * 1000;

export interface MoodDiaryRewardResult {
  rewarded: boolean;
  nextAvailableAt: string | null;
  pet: PublicPet | null;
  xpGained: number;
  gemsAwarded: number;
  item?: { itemType: string; label: string; imageUrl?: string; emoji?: string; qty: number };
}

/**
 * Attempts to grant mood-diary rewards (XP, gems, chance of a loot item).
 * Always callable after creating a MoodLog — returns rewarded:false when on cooldown.
 */
export async function tryGrantMoodDiaryReward(userId: string): Promise<MoodDiaryRewardResult> {
  const userIdObj = new Types.ObjectId(userId);
  const lastRewarded = await MoodLog.findOne({ userId: userIdObj, rewarded: true })
    .sort({ createdAt: -1 })
    .lean();

  if (lastRewarded?.createdAt) {
    const elapsed = Date.now() - new Date(lastRewarded.createdAt).getTime();
    if (elapsed < MOOD_REWARD_COOLDOWN_MS) {
      const next = new Date(new Date(lastRewarded.createdAt).getTime() + MOOD_REWARD_COOLDOWN_MS);
      return {
        rewarded: false,
        nextAvailableAt: next.toISOString(),
        pet: await petService.getPet(userId),
        xpGained: 0,
        gemsAwarded: 0,
      };
    }
  }

  const { pet, xpGained } = await petService.grantBonusXP(
    userId,
    SKILL_XP_REWARDS.health_mood,
    'mood_diary',
    'health',
  );
  await petService.raiseMoodFromFarmAction(userId, 3);

  const farm = await farmService.loadOrCreateFarm(userId);
  const level = farmService.farmLevelOf(farm);
  const gemsAwarded = 30 * level.level;
  farm.gems += gemsAwarded;

  let item: MoodDiaryRewardResult['item'];
  // ~40% chance of a small balloon-loot item so mood logging feels intertwined with the farm.
  if (Math.random() < 0.4) {
    const config = await BalloonLootConfig.findOne().lean();
    const entries = config?.entries ?? [];
    const validItemTypes = new Set((await GameItemDef.find().select('itemType').lean()).map((d) => d.itemType));
    const eligible = entries.filter((e) => validItemTypes.has(e.itemType));
    if (eligible.length > 0) {
      const picked = weightedPick(
        eligible,
        (e) => e.weight ?? RARITY_WEIGHTS[e.rarity as keyof typeof RARITY_WEIGHTS],
      );
      const def = await GameItemDef.findOne({ itemType: picked.itemType }).lean();
      const current = farm.inventory.get(picked.itemType) ?? 0;
      farm.inventory.set(picked.itemType, current + 1);
      farm.markModified('inventory');
      item = {
        itemType: picked.itemType,
        label: def?.label ?? picked.itemType,
        imageUrl: def?.imageUrl,
        emoji: def?.emoji,
        qty: 1,
      };
    }
  }

  await farm.save();

  log.info(
    { userId, xpGained, gemsAwarded, itemType: item?.itemType, farmLevel: level.level },
    'Mood diary reward granted',
  );

  return {
    rewarded: true,
    nextAvailableAt: new Date(Date.now() + MOOD_REWARD_COOLDOWN_MS).toISOString(),
    pet: (await petService.getPet(userId)) ?? pet,
    xpGained,
    gemsAwarded,
    item,
  };
}

/** Next reward time for UI (null if rewards are available now). */
export async function getMoodRewardStatus(userId: string): Promise<{
  nextAvailableAt: string | null;
  canReward: boolean;
}> {
  const lastRewarded = await MoodLog.findOne({ userId, rewarded: true })
    .sort({ createdAt: -1 })
    .lean();
  if (!lastRewarded?.createdAt) return { nextAvailableAt: null, canReward: true };
  const next = new Date(new Date(lastRewarded.createdAt).getTime() + MOOD_REWARD_COOLDOWN_MS);
  if (Date.now() >= next.getTime()) return { nextAvailableAt: null, canReward: true };
  return { nextAvailableAt: next.toISOString(), canReward: false };
}
