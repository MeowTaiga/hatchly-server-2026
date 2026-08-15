/**
 * Wipe game progress so an account plays like a brand-new farm.
 * Leaves health tracking (food/mood/weight/water logs, goals) and account
 * identity (pet species, onboarding, theme, friends, subscription) alone.
 */
import { Farm } from '../models/Farm.js';
import { User } from '../models/User.js';
import { UserRecipeJournal } from '../models/UserRecipeJournal.js';
import { UserCollection } from '../models/UserCollection.js';
import { DailyLoginReward } from '../models/DailyLoginReward.js';
import { Mail } from '../models/Mail.js';
import { PetPetLog } from '../models/PetPetLog.js';
import { farmService } from './FarmService.js';
import { questService } from './quests/index.js';
import { balloonService } from './BalloonService.js';
import { createDefaultSkills, totalSkillLevel } from './SkillXpService.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('GameAccountReset');

export interface GameAccountResetResult {
  farmDeleted: number;
  recipesCleared: number;
  catchesCleared: number;
  dailyRewardsCleared: number;
  questsCleared: number;
  mailCleared: number;
  petLogsCleared: number;
}

export async function resetGameAccount(userId: string): Promise<GameAccountResetResult> {
  balloonService.clearBalloons(userId);

  const [
    farmDelete,
    recipeDelete,
    collectionDelete,
    dailyDelete,
    questsCleared,
    mailDelete,
    petLogDelete,
  ] = await Promise.all([
    Farm.deleteOne({ userId }),
    UserRecipeJournal.deleteMany({ userId }),
    UserCollection.deleteMany({ userId }),
    DailyLoginReward.deleteMany({ userId }),
    questService.resetForUser(userId),
    Mail.deleteMany({ toUserId: userId, isBroadcast: { $ne: true } }),
    PetPetLog.deleteMany({ userId }),
  ]);

  const user = await User.findById(userId);
  if (user) {
    user.skills = createDefaultSkills();
    user.markModified('skills');
    if (user.pet) {
      user.pet.level = totalSkillLevel(user.skills);
      user.pet.xp = 0;
      user.pet.xpToNextLevel = 1;
      user.pet.hunger = 100;
      user.pet.happy = 100;
      user.pet.mood = 100;
      user.markModified('pet');
    }
    await user.save();
  }

  // Recreate immediately so starter house / NPC / trees / pickups land before
  // the client reconnects — same path as a brand-new account.
  await farmService.loadOrCreateFarm(userId);

  const result: GameAccountResetResult = {
    farmDeleted: farmDelete.deletedCount ?? 0,
    recipesCleared: recipeDelete.deletedCount ?? 0,
    catchesCleared: collectionDelete.deletedCount ?? 0,
    dailyRewardsCleared: dailyDelete.deletedCount ?? 0,
    questsCleared,
    mailCleared: mailDelete.deletedCount ?? 0,
    petLogsCleared: petLogDelete.deletedCount ?? 0,
  };
  log.info({ userId, ...result }, 'Game account reset to new-player state');
  return result;
}
