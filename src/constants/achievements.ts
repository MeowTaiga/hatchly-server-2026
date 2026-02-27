// ─── Achievement Definitions ─────────────────────────────────────────────────
//
// Single source of truth for every achievement in the game.
// To add a new achievement: just add an entry to ACHIEVEMENTS below.
// The AchievementService handles all granting logic automatically.
// ─────────────────────────────────────────────────────────────────────────────

export type AchievementCategory = 'food' | 'water' | 'weight' | 'general';

export interface AchievementDef {
  /** Unique machine key — stored in the DB */
  id: string;
  /** Human-readable title shown in the UI */
  title: string;
  /** Short description of how to earn it */
  description: string;
  /** Encouraging message shown in the popup */
  message: string;
  /** Grouping category for UI filtering */
  category: AchievementCategory;
  /** XP reward when unlocked */
  xpReward: number;
  /** Icon name or emoji for the frontend */
  icon: string;
}

// ─── Registry ────────────────────────────────────────────────────────────────

const def = (
  id: string,
  title: string,
  description: string,
  message: string,
  category: AchievementCategory,
  xpReward: number,
  icon: string,
): AchievementDef => ({ id, title, description, message, category, xpReward, icon });

export const ACHIEVEMENTS = {
  // ── Food milestones ──────────────────────────────────────────────────────
  FIRST_FOOD_LOG:       def('FIRST_FOOD_LOG',       'First Bite',         'Log your first food item',        "You're on your way! Every healthy choice starts with one bite.", 'food', 25,  '🍎'),
  FOOD_LOGS_10:         def('FOOD_LOGS_10',          'Getting Started',    'Log 10 food items',               "10 logs already — you're building an amazing habit! Keep it up!", 'food', 50,  '🥗'),
  FOOD_LOGS_50:         def('FOOD_LOGS_50',          'Consistent Tracker', 'Log 50 food items',               "50 logs! Your dedication is truly inspiring. Your pet is so proud of you!", 'food', 100, '📋'),
  FOOD_LOGS_100:        def('FOOD_LOGS_100',         'Century Club',       'Log 100 food items',              "Triple digits! You're in the top tier of trackers. Absolutely incredible!", 'food', 200, '💯'),
  FOOD_LOGS_250:        def('FOOD_LOGS_250',         'Dedicated Logger',   'Log 250 food items',              "250 logs — that's real commitment! You're a nutrition rockstar!", 'food', 400, '🏅'),
  FOOD_LOGS_500:        def('FOOD_LOGS_500',         'Food Diary Master',  'Log 500 food items',              "500! You've made tracking second nature. Your future self thanks you!", 'food', 750, '📖'),
  FOOD_LOGS_1000:       def('FOOD_LOGS_1000',        'Nutrition Legend',   'Log 1,000 food items',            "ONE THOUSAND! You are a true legend. Nothing can stop you now!", 'food', 1500,'🏆'),

  // ── Water milestones ─────────────────────────────────────────────────────
  FIRST_WATER_LOG:      def('FIRST_WATER_LOG',       'First Sip',          'Log your first water intake',     "Hydration station! Your body is already thanking you.", 'water', 15, '💧'),
  WATER_LOGS_10:        def('WATER_LOGS_10',          'Hydration Habit',    'Log water 10 times',              "10 sips tracked! Staying hydrated is a superpower — and you've got it!", 'water', 30, '🚰'),
  WATER_LOGS_50:        def('WATER_LOGS_50',          'Water Warrior',      'Log water 50 times',              "50 water logs! You're flowing with greatness. Keep that hydration going!", 'water', 75, '🌊'),
  WATER_LOGS_100:       def('WATER_LOGS_100',         'Hydration Hero',     'Log water 100 times',             "100 water logs — you're basically a hydration superhero at this point!", 'water', 150,'💦'),
  WATER_LOGS_500:       def('WATER_LOGS_500',         'Aqua Legend',        'Log water 500 times',             "500! You've made hydration a lifestyle. Absolutely legendary!", 'water', 500,'🏊'),

  // ── Weight milestones ────────────────────────────────────────────────────
  FIRST_WEIGHT_LOG:     def('FIRST_WEIGHT_LOG',      'First Weigh-In',     'Log your weight for the first time', "Great start! Tracking is the first step to reaching your goals.", 'weight', 20, '⚖️'),
  WEIGHT_LOGS_7:        def('WEIGHT_LOGS_7',          'Week Streak',        'Log your weight 7 times',           "A full week of tracking! Consistency is your secret weapon!", 'weight', 50, '📊'),
  WEIGHT_LOGS_30:       def('WEIGHT_LOGS_30',         'Monthly Tracker',    'Log your weight 30 times',          "30 weigh-ins! A whole month of dedication. You're unstoppable!", 'weight', 150,'📈'),
  WEIGHT_LOGS_100:      def('WEIGHT_LOGS_100',        'Scale Master',       'Log your weight 100 times',         "100 weigh-ins! You've mastered the scale. Your progress is incredible!", 'weight', 400,'🎯'),
} as const;

/** Type-safe achievement key */
export type AchievementKey = keyof typeof ACHIEVEMENTS;

/** Quick lookup map: id string → definition */
export const ACHIEVEMENT_BY_ID = new Map<string, AchievementDef>(
  Object.values(ACHIEVEMENTS).map((a) => [a.id, a]),
);
