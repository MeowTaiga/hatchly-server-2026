import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { createLogger } from '../config/logger.js';
import { fatSecretService } from '../services/FatSecretService.js';
import { FoodLog, Recipe } from '../models/FoodLog.js';
import { UserMacroGoals } from '../models/UserMacroGoals.js';
import { grantActionRewards } from '../services/ActionRewardService.js';
import { achievementService } from '../services/AchievementService.js';
import { AppError } from '../middleware/errorHandler.js';

const log = createLogger('FoodRoute');
const router = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeFoodItem(raw: any) {
  return {
    foodId: String(raw.food_id),
    name: raw.food_name ?? '',
    brand: raw.brand_name || undefined,
    description: raw.food_description ?? '',
    type: raw.food_type ?? 'Generic',
  };
}

function normalizeServing(raw: any) {
  return {
    servingId: String(raw.serving_id),
    description: raw.serving_description ?? '',
    calories: parseFloat(raw.calories) || 0,
    protein: parseFloat(raw.protein) || 0,
    fat: parseFloat(raw.fat) || 0,
    carbs: parseFloat(raw.carbohydrate) || 0,
    sugar: parseFloat(raw.sugar) || 0,
    fiber: parseFloat(raw.fiber) || 0,
    saturatedFat: parseFloat(raw.saturated_fat) || 0,
    transFat: parseFloat(raw.trans_fat) || 0,
    addedSugars: parseFloat(raw.added_sugars) || 0,
    sodium: parseFloat(raw.sodium) || 0,
    potassium: parseFloat(raw.potassium) || 0,
    cholesterol: parseFloat(raw.cholesterol) || 0,
    iron: parseFloat(raw.iron) || 0,
    calcium: parseFloat(raw.calcium) || 0,
    vitaminA: parseFloat(raw.vitamin_a) || 0,
    vitaminC: parseFloat(raw.vitamin_c) || 0,
    vitaminD: parseFloat(raw.vitamin_d) || 0,
  };
}

// ─── Schemas ────────────────────────────────────────────────────────────────

const searchSchema = {
  query: z.object({
    q: z.string().min(1),
    page: z.coerce.number().int().min(0).default(0),
  }),
};


const logSchema = {
  body: z.object({
    foodId: z.string().min(1),
    foodName: z.string().min(1),
    brandName: z.string().optional(),
    servingDescription: z.string().min(1),
    numberOfServings: z.coerce.number().positive().default(1),
    calories: z.coerce.number().min(0),
    protein: z.coerce.number().min(0).default(0),
    fat: z.coerce.number().min(0).default(0),
    carbs: z.coerce.number().min(0).default(0),
    sugar: z.coerce.number().min(0).default(0).optional(),
    fiber: z.coerce.number().min(0).default(0).optional(),
    saturatedFat: z.coerce.number().min(0).default(0).optional(),
    transFat: z.coerce.number().min(0).default(0).optional(),
    addedSugars: z.coerce.number().min(0).default(0).optional(),
    sodium: z.coerce.number().min(0).default(0).optional(),
    potassium: z.coerce.number().min(0).default(0).optional(),
    cholesterol: z.coerce.number().min(0).default(0).optional(),
    iron: z.coerce.number().min(0).default(0).optional(),
    calcium: z.coerce.number().min(0).default(0).optional(),
    vitaminA: z.coerce.number().min(0).default(0).optional(),
    vitaminC: z.coerce.number().min(0).default(0).optional(),
    vitaminD: z.coerce.number().min(0).default(0).optional(),
    mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
};

const logQuerySchema = {
  query: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
};

const logRangeQuerySchema = {
  query: z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
};

const recipeSchema = {
  body: z.object({
    name: z.string().min(1).max(100),
    ingredients: z.array(z.object({
      foodId: z.string().min(1),
      foodName: z.string().min(1),
      servingDescription: z.string().min(1),
      numberOfServings: z.coerce.number().positive(),
      calories: z.coerce.number().min(0),
      protein: z.coerce.number().min(0).default(0),
      fat: z.coerce.number().min(0).default(0),
      carbs: z.coerce.number().min(0).default(0),
      sugar: z.coerce.number().min(0).default(0).optional(),
      fiber: z.coerce.number().min(0).default(0).optional(),
      saturatedFat: z.coerce.number().min(0).default(0).optional(),
      transFat: z.coerce.number().min(0).default(0).optional(),
      addedSugars: z.coerce.number().min(0).default(0).optional(),
      sodium: z.coerce.number().min(0).default(0).optional(),
      potassium: z.coerce.number().min(0).default(0).optional(),
      cholesterol: z.coerce.number().min(0).default(0).optional(),
      iron: z.coerce.number().min(0).default(0).optional(),
      calcium: z.coerce.number().min(0).default(0).optional(),
      vitaminA: z.coerce.number().min(0).default(0).optional(),
      vitaminC: z.coerce.number().min(0).default(0).optional(),
      vitaminD: z.coerce.number().min(0).default(0).optional(),
    })).min(1),
    servings: z.coerce.number().positive().default(1),
  }),
};

// ─── GET /food/search ───────────────────────────────────────────────────────

router.get(
  '/search',
  protect,
  validate(searchSchema),
  catchAsync(async (req, res) => {
    const { q, page } = req.query as unknown as { q: string; page: number };
    const raw = await fatSecretService.search(q, page);

    const list = raw?.foods?.food;
    const foods = Array.isArray(list) ? list.map(normalizeFoodItem) : [];
    const total = parseInt(raw?.foods?.total_results ?? '0', 10);

    success(res, { foods, total, page });
  }),
);

// ─── POST /food/log ─────────────────────────────────────────────────────────

router.post(
  '/log',
  protect,
  validate(logSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const clientDate = req.body.date ?? new Date().toISOString().slice(0, 10);
    const entry = await FoodLog.create({ ...req.body, userId, date: clientDate });

    // Pet XP + gems (pass client date for accurate daily cap tracking)
    const { pet, xpGained, gemsAwarded } = await grantActionRewards(userId, 'food', clientDate);

    // Achievement checks
    const achievements = await achievementService.checkFood(userId);

    log.info({ userId, foodName: req.body.foodName }, 'Food logged');
    success(res, {
      log: entry,
      pet,
      xpGained,
      gemsAwarded,
      achievements: achievements.unlocked,
    }, 201);
  }),
);

// ─── GET /food/log/recent ───────────────────────────────────────────────────

router.get(
  '/log/recent',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const recent = await FoodLog.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $sort: { loggedAt: -1 } },
      { $group: {
        _id: '$foodId',
        foodName: { $first: '$foodName' },
        brandName: { $first: '$brandName' },
        servingDescription: { $first: '$servingDescription' },
        numberOfServings: { $first: '$numberOfServings' },
        calories: { $first: '$calories' },
        protein: { $first: '$protein' },
        fat: { $first: '$fat' },
        carbs: { $first: '$carbs' },
        sugar: { $first: '$sugar' },
        fiber: { $first: '$fiber' },
        saturatedFat: { $first: '$saturatedFat' },
        transFat: { $first: '$transFat' },
        addedSugars: { $first: '$addedSugars' },
        sodium: { $first: '$sodium' },
        potassium: { $first: '$potassium' },
        cholesterol: { $first: '$cholesterol' },
        iron: { $first: '$iron' },
        calcium: { $first: '$calcium' },
        vitaminA: { $first: '$vitaminA' },
        vitaminC: { $first: '$vitaminC' },
        vitaminD: { $first: '$vitaminD' },
        mealType: { $first: '$mealType' },
        lastLogged: { $first: '$loggedAt' },
      }},
      { $sort: { lastLogged: -1 } },
      { $limit: 10 },
    ]);

    const foods = recent.map((r) => ({
      foodId: r._id,
      foodName: r.foodName,
      brandName: r.brandName,
      servingDescription: r.servingDescription,
      numberOfServings: r.numberOfServings,
      calories: r.calories,
      protein: r.protein,
      fat: r.fat,
      carbs: r.carbs,
      sugar: r.sugar ?? 0,
      fiber: r.fiber ?? 0,
      saturatedFat: r.saturatedFat ?? 0,
      transFat: r.transFat ?? 0,
      addedSugars: r.addedSugars ?? 0,
      sodium: r.sodium ?? 0,
      potassium: r.potassium ?? 0,
      cholesterol: r.cholesterol ?? 0,
      iron: r.iron ?? 0,
      calcium: r.calcium ?? 0,
      vitaminA: r.vitaminA ?? 0,
      vitaminC: r.vitaminC ?? 0,
      vitaminD: r.vitaminD ?? 0,
      mealType: r.mealType,
      lastLogged: r.lastLogged,
    }));

    success(res, { foods });
  }),
);

// ─── GET /food/log/range ─────────────────────────────────────────────────────

router.get(
  '/log/range',
  protect,
  validate(logRangeQuerySchema),
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const { start, end } = req.query as { start: string; end: string };
    if (start > end) throw new AppError('start must be <= end', 400, 'INVALID_RANGE');
    const startDate = new Date(start);
    const endDate = new Date(end);
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (daysDiff > 31) throw new AppError('Range cannot exceed 31 days', 400, 'RANGE_TOO_LARGE');

    const raw = await FoodLog.find({
      userId,
      $or: [
        { date: { $gte: start, $lte: end } },
        {
          date: { $exists: false },
          loggedAt: {
            $gte: new Date(`${start}T00:00:00.000Z`),
            $lte: new Date(`${end}T23:59:59.999Z`),
          },
        },
      ],
    })
      .sort({ loggedAt: 1 })
      .lean();

    const safe = (v: number | undefined) => (v ?? 0);
    const byDate = new Map<string, { logs: any[]; totals: Record<string, number> }>();

    for (const l of raw) {
      const dateStr = l.date ?? new Date(l.loggedAt).toISOString().slice(0, 10);
      if (dateStr < start || dateStr > end) continue;
      if (!byDate.has(dateStr)) {
        byDate.set(dateStr, {
          logs: [],
          totals: { calories: 0, protein: 0, fat: 0, carbs: 0, sugar: 0, fiber: 0, saturatedFat: 0, transFat: 0, addedSugars: 0, sodium: 0, potassium: 0, cholesterol: 0, iron: 0, calcium: 0, vitaminA: 0, vitaminC: 0, vitaminD: 0 },
        });
      }
      const entry = byDate.get(dateStr)!;
      const { _id, __v, ...rest } = l as any;
      entry.logs.push({ id: _id.toString(), ...rest });
      entry.totals.calories += l.calories * l.numberOfServings;
      entry.totals.protein += safe(l.protein) * l.numberOfServings;
      entry.totals.fat += safe(l.fat) * l.numberOfServings;
      entry.totals.carbs += safe(l.carbs) * l.numberOfServings;
      entry.totals.sugar += safe(l.sugar) * l.numberOfServings;
      entry.totals.fiber += safe(l.fiber) * l.numberOfServings;
      entry.totals.saturatedFat += safe(l.saturatedFat) * l.numberOfServings;
      entry.totals.transFat += safe(l.transFat) * l.numberOfServings;
      entry.totals.addedSugars += safe(l.addedSugars) * l.numberOfServings;
      entry.totals.sodium += safe(l.sodium) * l.numberOfServings;
      entry.totals.potassium += safe(l.potassium) * l.numberOfServings;
      entry.totals.cholesterol += safe(l.cholesterol) * l.numberOfServings;
      entry.totals.iron += safe(l.iron) * l.numberOfServings;
      entry.totals.calcium += safe(l.calcium) * l.numberOfServings;
      entry.totals.vitaminA += safe(l.vitaminA) * l.numberOfServings;
      entry.totals.vitaminC += safe(l.vitaminC) * l.numberOfServings;
      entry.totals.vitaminD += safe(l.vitaminD) * l.numberOfServings;
    }

    const daily = Array.from({ length: daysDiff }, (_, i) => {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      const data = byDate.get(dateStr);
      return {
        date: dateStr,
        logs: data?.logs ?? [],
        totals: data?.totals ?? { calories: 0, protein: 0, fat: 0, carbs: 0, sugar: 0, fiber: 0, saturatedFat: 0, transFat: 0, addedSugars: 0, sodium: 0, potassium: 0, cholesterol: 0, iron: 0, calcium: 0, vitaminA: 0, vitaminC: 0, vitaminD: 0 },
      };
    });

    log.info({ userId, start, end, days: daily.length }, 'Food log range fetched');
    success(res, { daily });
  }),
);

// ─── GET /food/log ──────────────────────────────────────────────────────────

router.get(
  '/log',
  protect,
  validate(logQuerySchema),
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const dateStr = (req.query as any).date ?? new Date().toISOString().slice(0, 10);

    // New logs have a `date` string field set by the client.
    // Old logs without `date` fall back to UTC loggedAt range.
    const utcStart = new Date(`${dateStr}T00:00:00.000Z`);
    const utcEnd = new Date(`${dateStr}T23:59:59.999Z`);

    const raw = await FoodLog.find({
      userId,
      $or: [
        { date: dateStr },
        { date: { $exists: false }, loggedAt: { $gte: utcStart, $lte: utcEnd } },
      ],
    })
      .sort({ loggedAt: -1 })
      .lean();

    const logs = raw.map(({ _id, __v, ...rest }) => ({ id: _id.toString(), ...rest }));

    const safe = (v: number | undefined) => (v ?? 0);
    const totals = logs.reduce(
      (acc, l) => ({
        calories: acc.calories + l.calories * l.numberOfServings,
        protein: acc.protein + safe(l.protein) * l.numberOfServings,
        fat: acc.fat + safe(l.fat) * l.numberOfServings,
        carbs: acc.carbs + safe(l.carbs) * l.numberOfServings,
        sugar: acc.sugar + safe(l.sugar) * l.numberOfServings,
        fiber: acc.fiber + safe(l.fiber) * l.numberOfServings,
        saturatedFat: acc.saturatedFat + safe(l.saturatedFat) * l.numberOfServings,
        transFat: acc.transFat + safe(l.transFat) * l.numberOfServings,
        addedSugars: acc.addedSugars + safe(l.addedSugars) * l.numberOfServings,
        sodium: acc.sodium + safe(l.sodium) * l.numberOfServings,
        potassium: acc.potassium + safe(l.potassium) * l.numberOfServings,
        cholesterol: acc.cholesterol + safe(l.cholesterol) * l.numberOfServings,
        iron: acc.iron + safe(l.iron) * l.numberOfServings,
        calcium: acc.calcium + safe(l.calcium) * l.numberOfServings,
        vitaminA: acc.vitaminA + safe(l.vitaminA) * l.numberOfServings,
        vitaminC: acc.vitaminC + safe(l.vitaminC) * l.numberOfServings,
        vitaminD: acc.vitaminD + safe(l.vitaminD) * l.numberOfServings,
      }),
      { calories: 0, protein: 0, fat: 0, carbs: 0, sugar: 0, fiber: 0, saturatedFat: 0, transFat: 0, addedSugars: 0, sodium: 0, potassium: 0, cholesterol: 0, iron: 0, calcium: 0, vitaminA: 0, vitaminC: 0, vitaminD: 0 },
    );

    log.info({ userId, dateStr, logsCount: logs.length }, 'Food log fetched');
    success(res, { logs, totals, date: dateStr });
  }),
);

// ─── POST /food/recipe ──────────────────────────────────────────────────────

router.post(
  '/recipe',
  protect,
  validate(recipeSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const { name, ingredients, servings } = req.body;
    const safe = (v: number | undefined) => v ?? 0;

    const totals = ingredients.reduce(
      (acc: any, i: any) => ({
        calories: acc.calories + i.calories * i.numberOfServings,
        protein: acc.protein + safe(i.protein) * i.numberOfServings,
        fat: acc.fat + safe(i.fat) * i.numberOfServings,
        carbs: acc.carbs + safe(i.carbs) * i.numberOfServings,
        sugar: acc.sugar + safe(i.sugar) * i.numberOfServings,
        fiber: acc.fiber + safe(i.fiber) * i.numberOfServings,
        sodium: acc.sodium + safe(i.sodium) * i.numberOfServings,
        potassium: acc.potassium + safe(i.potassium) * i.numberOfServings,
        iron: acc.iron + safe(i.iron) * i.numberOfServings,
        calcium: acc.calcium + safe(i.calcium) * i.numberOfServings,
        vitaminA: acc.vitaminA + safe(i.vitaminA) * i.numberOfServings,
        vitaminC: acc.vitaminC + safe(i.vitaminC) * i.numberOfServings,
        vitaminD: acc.vitaminD + safe(i.vitaminD) * i.numberOfServings,
      }),
      { calories: 0, protein: 0, fat: 0, carbs: 0, sugar: 0, fiber: 0, sodium: 0, potassium: 0, iron: 0, calcium: 0, vitaminA: 0, vitaminC: 0, vitaminD: 0 },
    );

    const recipe = await Recipe.create({
      userId, name, ingredients, servings,
      totalCalories: totals.calories,
      totalProtein: totals.protein,
      totalFat: totals.fat,
      totalCarbs: totals.carbs,
      totalSugar: totals.sugar,
      totalFiber: totals.fiber,
      totalSodium: totals.sodium,
      totalPotassium: totals.potassium,
      totalIron: totals.iron,
      totalCalcium: totals.calcium,
      totalVitaminA: totals.vitaminA,
      totalVitaminC: totals.vitaminC,
      totalVitaminD: totals.vitaminD,
    });

    log.info({ userId, recipeName: name }, 'Recipe created');
    success(res, { recipe }, 201);
  }),
);

// ─── GET /food/recipes ──────────────────────────────────────────────────────

router.get(
  '/recipes',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const recipes = await Recipe.find({ userId }).sort({ createdAt: -1 }).lean();
    success(res, { recipes });
  }),
);

// ─── DELETE /food/log/:id ───────────────────────────────────────────────────

router.delete(
  '/log/:id',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const entry = await FoodLog.findOneAndDelete({ _id: req.params.id, userId });
    if (!entry) throw new AppError('Log not found', 404, 'NOT_FOUND');

    log.info({ userId, logId: req.params.id }, 'Food log deleted');
    success(res, { deleted: true });
  }),
);

// ─── PATCH /food/log/:id ────────────────────────────────────────────────────

router.patch(
  '/log/:id',
  protect,
  validate({
    body: z.object({
      mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
    }),
  }),
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const entry = await FoodLog.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: req.body },
      { new: true },
    );
    if (!entry) throw new AppError('Log not found', 404, 'NOT_FOUND');

    success(res, { log: entry });
  }),
);

// ─── GET /food/macro-goals ──────────────────────────────────────────────────

const macroGoalsSchema = z.object({
  protein: z.coerce.number().min(0).optional(),
  fat: z.coerce.number().min(0).optional(),
  saturatedFat: z.coerce.number().min(0).optional(),
  transFat: z.coerce.number().min(0).optional(),
  carbs: z.coerce.number().min(0).optional(),
  sugar: z.coerce.number().min(0).optional(),
  addedSugars: z.coerce.number().min(0).optional(),
  fiber: z.coerce.number().min(0).optional(),
  sodium: z.coerce.number().min(0).optional(),
  potassium: z.coerce.number().min(0).optional(),
  cholesterol: z.coerce.number().min(0).optional(),
  iron: z.coerce.number().min(0).optional(),
  calcium: z.coerce.number().min(0).optional(),
  vitaminA: z.coerce.number().min(0).optional(),
  vitaminC: z.coerce.number().min(0).optional(),
  vitaminD: z.coerce.number().min(0).optional(),
}).strict();

router.get(
  '/macro-goals',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const doc = await UserMacroGoals.findOne({ userId }).lean();
    const goals = doc ? {
      protein: doc.protein,
      fat: doc.fat,
      saturatedFat: doc.saturatedFat,
      transFat: doc.transFat,
      carbs: doc.carbs,
      sugar: doc.sugar,
      addedSugars: doc.addedSugars,
      fiber: doc.fiber,
      sodium: doc.sodium,
      potassium: doc.potassium,
      cholesterol: doc.cholesterol,
      iron: doc.iron,
      calcium: doc.calcium,
      vitaminA: doc.vitaminA,
      vitaminC: doc.vitaminC,
      vitaminD: doc.vitaminD,
    } : null;
    success(res, { goals });
  }),
);

// ─── PATCH /food/macro-goals ─────────────────────────────────────────────────

router.patch(
  '/macro-goals',
  protect,
  validate({ body: macroGoalsSchema }),
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const updates = req.body as Record<string, number>;
    if (Object.keys(updates).length === 0) {
      return success(res, { goals: null });
    }

    const doc = await UserMacroGoals.findOneAndUpdate(
      { userId },
      { $set: updates },
      { new: true, upsert: true },
    ).lean();

    const goals = {
      protein: doc!.protein,
      fat: doc!.fat,
      saturatedFat: doc!.saturatedFat,
      transFat: doc!.transFat,
      carbs: doc!.carbs,
      sugar: doc!.sugar,
      addedSugars: doc!.addedSugars,
      fiber: doc!.fiber,
      sodium: doc!.sodium,
      potassium: doc!.potassium,
      cholesterol: doc!.cholesterol,
      iron: doc!.iron,
      calcium: doc!.calcium,
      vitaminA: doc!.vitaminA,
      vitaminC: doc!.vitaminC,
      vitaminD: doc!.vitaminD,
    };
    success(res, { goals });
  }),
);

// ─── GET /food/barcode/:barcode — lookup by UPC/EAN ─────────────────────────

router.get(
  '/barcode/:barcode',
  protect,
  catchAsync(async (req, res) => {
    const barcode = String(req.params.barcode ?? '').trim();
    if (!barcode) throw new AppError('Barcode is required', 400, 'INVALID_BARCODE');

    const userId = req.user?.id;

    try {
      const raw = await fatSecretService.getByBarcode(barcode);
      const f = raw?.food;
      if (!f) {
        log.warn({ userId, barcode }, 'FatSecret barcode lookup returned no food');
        throw new AppError('Food not found for this barcode', 404, 'BARCODE_NOT_FOUND');
      }

      const rawServings = f.servings?.serving;
      const servings = Array.isArray(rawServings)
        ? rawServings.map(normalizeServing)
        : rawServings ? [normalizeServing(rawServings)] : [];

      log.info({ userId, barcode, foodId: f.food_id, foodName: f.food_name }, 'Barcode lookup success');
      success(res, {
        food: {
          foodId: String(f.food_id),
          name: f.food_name ?? '',
          brand: f.brand_name || undefined,
          servings,
        },
      });
    } catch (err: any) {
      if (err.name === 'AppError') throw err;
      log.error({ err, userId, barcode }, 'FatSecret barcode lookup failed');
      throw new AppError('Food not found for this barcode', 404, 'BARCODE_NOT_FOUND');
    }
  }),
);

// ─── GET /food/:id (FatSecret detail) — MUST be last (catch-all param) ─────

router.get(
  '/:id',
  protect,
  catchAsync(async (req, res) => {
    const raw = await fatSecretService.getById(String(req.params.id));
    const f = raw?.food;
    if (!f) throw new AppError('Food not found', 404, 'FOOD_NOT_FOUND');

    const rawServings = f.servings?.serving;
    const servings = Array.isArray(rawServings)
      ? rawServings.map(normalizeServing)
      : rawServings ? [normalizeServing(rawServings)] : [];

    success(res, {
      food: {
        foodId: String(f.food_id),
        name: f.food_name ?? '',
        brand: f.brand_name || undefined,
        servings,
      },
    });
  }),
);

export default router;
