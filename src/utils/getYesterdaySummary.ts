import { Types } from 'mongoose';
import { FoodLog } from '../models/FoodLog.js';
import { WaterLog } from '../models/WaterLog.js';
import { WeightLog } from '../models/WeightLog.js';
import { MoodLog } from '../models/MoodLog.js';
import { UserQuest } from '../models/UserQuest.js';
import { UserCollection } from '../models/UserCollection.js';

/**
 * Returns yesterday's date as YYYY-MM-DD in the given timezone.
 * Falls back to UTC if timezone is invalid.
 */
export function getYesterdayDateStr(timezone?: string): string {
  const today = getTodayDateStr(timezone);
  const [y, m, d] = today.split('-').map(Number);
  const yesterday = new Date(Date.UTC(y, m - 1, d - 1));
  return yesterday.toISOString().slice(0, 10);
}

/**
 * Returns the date N days ago as YYYY-MM-DD in the given timezone.
 * Used when placing fully grown trees so they don't regress on the next day.
 */
export function getDaysAgoDateStr(daysAgo: number, timezone?: string): string {
  const today = getTodayDateStr(timezone);
  const [y, m, d] = today.split('-').map(Number);
  const past = new Date(Date.UTC(y, m - 1, d - daysAgo));
  return past.toISOString().slice(0, 10);
}

/**
 * Returns today's date as YYYY-MM-DD in the given timezone.
 */
export function getTodayDateStr(timezone?: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(now);
    const y = parts.find((p) => p.type === 'year')?.value ?? '';
    const m = parts.find((p) => p.type === 'month')?.value ?? '';
    const d = parts.find((p) => p.type === 'day')?.value ?? '';
    return `${y}-${m}-${d}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export interface YesterdaySummary {
  foodLogCount: number;
  waterOz: number;
  weightLbs: number | null;
  questsCompleted: number;
  fishCaught: number;
  bugsCaught: number;
}

export interface TodayFoodEntry {
  foodName: string;
  mealType: string;
  calories: number;
  servings?: number;
}

export interface TodaySummary {
  foodLogCount: number;
  calories: number;
  waterOz: number;
  weightLbs: number | null;
  mood?: string;
  /** All mood diary entries today, formatted for the pet prompt. */
  moodDiary?: string;
  foods: TodayFoodEntry[];
}

/**
 * Aggregates today's food, water, and weight for pet chat context.
 * Includes full food list so the pet can reference what the user ate.
 */
export async function getTodaySummary(userId: string, timezone?: string): Promise<TodaySummary> {
  const userIdObj = new Types.ObjectId(userId);
  const today = getTodayDateStr(timezone);

  const [foodLogs, waterLogs, weightLog, moodLogs] = await Promise.all([
    FoodLog.find({ userId: userIdObj, date: today }).sort({ loggedAt: 1 }).lean(),
    WaterLog.find({ userId: userIdObj, date: today }).lean(),
    WeightLog.findOne({ userId: userIdObj, date: today }).lean(),
    MoodLog.find({ userId: userIdObj, date: today }).sort({ createdAt: 1 }).lean(),
  ]);

  const calories = foodLogs.reduce((sum, l) => sum + (l.calories ?? 0) * (l.numberOfServings ?? 1), 0);
  const waterOz = waterLogs.reduce((sum, l) => sum + (l.amountOz ?? 0), 0);
  const foods: TodayFoodEntry[] = foodLogs.map((l) => {
    const cal = (l.calories ?? 0) * (l.numberOfServings ?? 1);
    return {
      foodName: l.foodName ?? 'Unknown',
      mealType: l.mealType ?? 'snack',
      calories: Math.round(cal),
      servings: l.numberOfServings,
    };
  });

  const latestMood = moodLogs.length ? moodLogs[moodLogs.length - 1] : null;
  const moodDiary =
    moodLogs.length > 0
      ? moodLogs
          .map((m) => (m.note ? `${m.mood} ("${m.note.slice(0, 80)}")` : m.mood))
          .join(', ')
      : undefined;

  return {
    foodLogCount: foodLogs.length,
    calories: Math.round(calories),
    waterOz: Math.round(waterOz * 10) / 10,
    weightLbs: weightLog?.weight ?? null,
    mood: latestMood?.mood ?? undefined,
    moodDiary,
    foods,
  };
}

/**
 * Aggregates yesterday's activity for AI greeting context.
 */
export async function getYesterdaySummary(userId: string, timezone?: string): Promise<YesterdaySummary> {
  const userIdObj = new Types.ObjectId(userId);
  const yesterday = getYesterdayDateStr(timezone);

  const yesterdayStart = new Date(`${yesterday}T00:00:00.000Z`);
  const yesterdayEnd = new Date(`${yesterday}T23:59:59.999Z`);

  const [foodCount, waterLogs, weightLog, completedQuests, fishCaught, bugsCaught] = await Promise.all([
    FoodLog.countDocuments({ userId: userIdObj, date: yesterday }),
    WaterLog.find({ userId: userIdObj, date: yesterday }).lean(),
    WeightLog.findOne({ userId: userIdObj, date: yesterday }).lean(),
    UserQuest.countDocuments({
      userId: userIdObj,
      status: 'completed',
      completedAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
    }),
    UserCollection.countDocuments({
      userId: userIdObj,
      category: 'fish',
      caughtAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
    }),
    UserCollection.countDocuments({
      userId: userIdObj,
      category: 'bug',
      caughtAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
    }),
  ]);

  const waterOz = waterLogs.reduce((sum, l) => sum + (l.amountOz ?? 0), 0);

  return {
    foodLogCount: foodCount,
    waterOz: Math.round(waterOz * 10) / 10,
    weightLbs: weightLog?.weight ?? null,
    questsCompleted: completedQuests,
    fishCaught,
    bugsCaught,
  };
}
