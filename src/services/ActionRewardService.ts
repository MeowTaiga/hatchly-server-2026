import { petService, type PublicPet, type XpAction } from './PetService.js';
import { farmService } from './FarmService.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('ActionRewardService');

/** Gems awarded per action type at each farm level. */
function gemsForAction(action: XpAction, farmLevel: number): number {
  switch (action) {
    case 'food':
      return 10 + (farmLevel - 1) * 15;
    case 'water':
      return 50 * farmLevel;
    case 'weight':
      return 50 * farmLevel;
    case 'mood':
      return 30 * farmLevel;
    default:
      return 0;
  }
}

export type ActionRewardResult = {
  pet: PublicPet | null;
  xpGained: number;
  gemsAwarded: number;
};

/**
 * Grants pet XP and farm gems for logging actions (food, water, weight).
 * Respects daily caps. Gems scale by farm level.
 */
export async function grantActionRewards(
  userId: string,
  action: XpAction,
  _clientDate?: string,
): Promise<ActionRewardResult> {
  // Daily XP caps use server clock + user timezone — ignore client-supplied dates.
  const result = await petService.gainXP(userId, action);

  if (result.xpGained === 0) {
    return { pet: result.pet, xpGained: 0, gemsAwarded: 0 };
  }

  const farm = await farmService.loadOrCreateFarm(userId);
  const level = farmService.farmLevelOf(farm);
  const gems = gemsForAction(action, level.level);

  farm.gems += gems;
  await farm.save();

  log.info({ userId, action, gems, farmLevel: level.level }, 'Action rewards granted');
  return {
    pet: result.pet,
    xpGained: result.xpGained,
    gemsAwarded: gems,
  };
}
