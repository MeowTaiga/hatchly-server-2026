import type { Model } from 'mongoose';
import { FoodLog } from '../models/FoodLog.js';
import { WaterLog } from '../models/WaterLog.js';
import { MoodLog } from '../models/MoodLog.js';
import { WeightLog } from '../models/WeightLog.js';
import { UserQuest } from '../models/UserQuest.js';
import { UserProgress } from '../models/UserProgress.js';
import { Achievement } from '../models/Achievement.js';
import { DailyLoginReward } from '../models/DailyLoginReward.js';
import { UserCollection } from '../models/UserCollection.js';
import { OnboardingProfile } from '@/models/OnboardingProfile.js';

/**
 * Collection keys the pet AI may query. Explicit whitelist — no dynamic names.
 */
export const PET_DATA_COLLECTION_KEYS = [
  'food_logs',
  'user_collections',
  'water_logs',
  'mood_logs',
  'weight_logs',
  'user_quests',
  'user_progress',
  'achievements',
  'daily_login_rewards',
  'onboarding_profile'
] as const;

export type PetDataCollectionKey = (typeof PET_DATA_COLLECTION_KEYS)[number];

export interface PetDataCollectionConfig {
  model: Model<any>;
  userIdField: 'userId';
  dateField?: string;
  /** Description for the AI to determine when to use this collection. */
  descriptionForAI: string;
}

/**
 * Whitelist of collections the pet may read. Only user-scoped collections.
 * Every query MUST include userId in the filter — injected server-side from auth.
 * descriptionForAI helps the model choose the right collection for the user's question.
 */
export const PET_DATA_COLLECTIONS: Record<PetDataCollectionKey, PetDataCollectionConfig> = {
  food_logs: {
    model: FoodLog,
    userIdField: 'userId',
    dateField: 'date',
    descriptionForAI: 'Food and nutrition entries: meals, calories, macros (protein, carbs, fat). Use when user asks about what they ate, calories, diet, or nutrition.',
  },
  water_logs: {
    model: WaterLog,
    userIdField: 'userId',
    dateField: 'date',
    descriptionForAI: 'Water/hydration intake in ounces per day. Use when user asks about water, hydration, or how much they drank.',
  },
  mood_logs: {
    model: MoodLog,
    userIdField: 'userId',
    dateField: 'date',
    descriptionForAI: 'Daily mood check-ins (great, good, okay, meh, down, anxious, excited). Use when user asks about their mood history or how they have been feeling.',
  },
  weight_logs: {
    model: WeightLog,
    userIdField: 'userId',
    dateField: 'date',
    descriptionForAI: 'Latest entry is the users CURRENT WEIGHT.Weight entries in lbs per day. Use when user asks about weight, scale, or body weight over time.',
  },
  user_collections: {
    model: UserCollection,
    userIdField: 'userId',
    dateField: 'caughtAt',
    descriptionForAI: 'Collected items: bugs, fish, discoverables. Use when user asks about what they caught, their collection, bugs, fish, or critters.',
  },
  user_quests: {
    model: UserQuest,
    userIdField: 'userId',
    descriptionForAI: 'Quest progress: active, completed, or locked quests. Use when user asks about quests, missions, or what they have completed.',
  },
  user_progress: {
    model: UserProgress,
    userIdField: 'userId',
    descriptionForAI: 'Game progress: scenes visited, exploration. Use when user asks about where they have been or game progress.',
  },
  achievements: {
    model: Achievement,
    userIdField: 'userId',
    descriptionForAI: 'Unlocked achievements and badges. Use when user asks about achievements, badges, or what they have accomplished.',
  },
  daily_login_rewards: {
    model: DailyLoginReward,
    userIdField: 'userId',
    dateField: 'date',
    descriptionForAI: 'Daily login streak: when user logged in each day. Use when user asks about login streaks, daily check-ins, or consistency.',
  },
  onboarding_profile: {
    model: OnboardingProfile,
    userIdField: 'userId',
    descriptionForAI: 'Has the Users height, starting weight as "currentWeight", and goal weight as "goalWeight". Use when user asks about their height, starting weight, or goal weight.',
  },
};

export function isAllowedCollection(key: string): key is PetDataCollectionKey {
  return PET_DATA_COLLECTION_KEYS.includes(key as PetDataCollectionKey);
}
