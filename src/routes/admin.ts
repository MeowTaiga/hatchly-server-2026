import mongoose from 'mongoose';
import { Router } from 'express';
import { z } from 'zod';
import { protect, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { createLogger } from '../config/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import { User } from '../models/User.js';
import { FoodLog } from '../models/FoodLog.js';
import { WaterLog } from '../models/WaterLog.js';
import { WeightLog } from '../models/WeightLog.js';
import { Achievement } from '../models/Achievement.js';
import { GameItemDef, ITEM_CATEGORIES, BUG_RARITIES, BUG_ACTIVE_TIMES, type IGameItemDef } from '../models/GameItemDef.js';
import { BalloonLootConfig, type IBalloonLootEntry } from '../models/BalloonLootConfig.js';
import { FossilLootConfig, type IFossilLootEntry } from '../models/FossilLootConfig.js';
import { RARITY_WEIGHTS } from '../utils/rarity.js';
import { ShopBanner, type IShopBanner } from '../models/ShopBanner.js';
import { openAIService } from '../services/OpenAIService.js';
import { storageService } from '../services/StorageService.js';
import { sceneryBakeService } from '../services/SceneryBakeService.js';
import { Scene } from '../models/Scene.js';
import { BakedScenery } from '../models/BakedScenery.js';
import { QuestDef } from '../models/QuestDef.js';
import { UserQuest } from '../models/UserQuest.js';
import { Farm } from '../models/Farm.js';
import { Recipe } from '../models/Recipe.js';
import { farmService, FARM_LEVELS } from '../services/FarmService.js';
import { getIO } from '../websocket/index.js';
import { WS_EVENTS } from '../websocket/events.js';
import { multiplayerManager } from '../services/MultiplayerManager.js';
import { mailService } from '../services/MailService.js';


const log = createLogger('AdminRoute');
const router = Router();

/** Log every request hitting /admin/* to diagnose routing. */
router.use((req, _res, next) => {
  log.info({ method: req.method, path: req.path, url: req.originalUrl }, 'Admin request');
  next();
});

/** Shared admin guard applied to every route in this file. */
const adminGuard = [protect, requireRole('admin', 'superadmin')];

/** Falls back to UTC if the client doesn't send a date. */
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const statsSchema = {
  query: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
};

// ─── GET /admin/stats ───────────────────────────────────────────────────────
// Returns aggregate counts for the given date (defaults to today).

router.get(
  '/stats',
  ...adminGuard,
  validate(statsSchema),
  catchAsync(async (req, res) => {
    const dateStr = (req.query as any).date ?? todayStr();

    // UTC boundaries for timestamp-based queries (FoodLog.loggedAt fallback)
    const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

    const [
      foodCount,
      foodCalories,
      waterCount,
      waterOz,
      weightCount,
      achievementsUnlocked,
      totalUsers,
      newUsersToday,
    ] = await Promise.all([
      // Food logs: match by date field OR loggedAt range for legacy docs
      FoodLog.countDocuments({
        $or: [
          { date: dateStr },
          { date: { $exists: false }, loggedAt: { $gte: dayStart, $lte: dayEnd } },
        ],
      }),
      FoodLog.aggregate([
        {
          $match: {
            $or: [
              { date: dateStr },
              { date: { $exists: false }, loggedAt: { $gte: dayStart, $lte: dayEnd } },
            ],
          },
        },
        { $group: { _id: null, total: { $sum: { $multiply: ['$calories', '$numberOfServings'] } } } },
      ]),

      // Water logs
      WaterLog.countDocuments({ date: dateStr }),
      WaterLog.aggregate([
        { $match: { date: dateStr } },
        { $group: { _id: null, total: { $sum: '$amountOz' } } },
      ]),

      // Weight logs
      WeightLog.countDocuments({ date: dateStr }),

      // Achievements unlocked today
      Achievement.countDocuments({
        unlockedAt: { $gte: dayStart, $lte: dayEnd },
      }),

      // Total users
      User.countDocuments(),

      // New users today
      User.countDocuments({
        createdAt: { $gte: dayStart, $lte: dayEnd },
      }),
    ]);

    const totalCalories = foodCalories[0]?.total ?? 0;
    const totalWaterOz = waterOz[0]?.total ?? 0;

    log.info({ admin: req.user?.id, date: dateStr }, 'Admin stats fetched');

    success(res, {
      date: dateStr,
      food: { logs: foodCount, totalCalories: Math.round(totalCalories) },
      water: { logs: waterCount, totalOz: Math.round(totalWaterOz * 10) / 10 },
      weight: { logs: weightCount },
      achievements: { unlocked: achievementsUnlocked },
      users: { total: totalUsers, newToday: newUsersToday },
    });
  }),
);

// ═════════════════════════════════════════════════════════════════════════════
// Game Item Admin CRUD
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Broadcasts the current item definitions to ALL connected game clients.
 * Called after every create / update / delete so games stay in sync.
 */
async function broadcastItemDefs(): Promise<void> {
  const defs = await GameItemDef.find().sort({ label: 1 }).lean();
  const map: Record<string, IGameItemDef> = {};
  for (const d of defs) map[d.itemType] = d;
  getIO().emit(WS_EVENTS.GAME_ITEM_DEFS_UPDATED, map);
}

// ─── Validation ─────────────────────────────────────────────────────────────

const directionalImagesSchema = z.object({
  post: z.string().url().optional(),
  end: z.string().url().optional(),
  straight: z.string().url().optional(),
  corner: z.string().url().optional(),
  tJunction: z.string().url().optional(),
  cross: z.string().url().optional(),
}).optional();

const categoryEnum = z.enum(ITEM_CATEGORIES as [string, ...string[]]);
const bugRarityEnum = z.enum(BUG_RARITIES as [string, ...string[]]);
const bugActiveTimeEnum = z.enum(BUG_ACTIVE_TIMES as [string, ...string[]]);

const gameItemBodySchema = z.object({
  itemType: z.string().min(1).max(48).regex(/^[a-z0-9_]+$/, 'Lowercase alphanumeric + underscores only'),
  label: z.string().min(1).max(48),
  emoji: z.string().max(8).optional().default('📦'),
  color: z.string().min(4).max(9),
  imageUrl: z.string().url().optional().or(z.literal('')),
  category: categoryEnum,
  subCategory: z.string().min(1).max(32).optional(),
  placeable: z.boolean(),
  cols: z.number().int().min(1).max(50),
  rows: z.number().int().min(1).max(50),
  growthMs: z.number().int().min(0).optional(),
  harvestYield: z.array(z.object({
    itemType: z.string().min(1),
    qty: z.number().int().min(1),
  })).optional(),
  interactAction: z.object({
    type: z.enum(['open_scene', 'open_modal', 'start_dialog', 'none']),
    payload: z.string().optional(),
  }).optional(),
  autoConnect: z.boolean().optional(),
  centerOverflow: z.boolean().optional(),
  directionalImages: directionalImagesSchema,
  buyable: z.boolean().optional(),
  gemPrice: z.number().int().min(0).optional(),
  farmLevel: z.number().int().min(0).optional(),
  petLevel: z.number().int().min(0).optional(),
  shopSection: z.string().min(1).max(32).optional().nullable(),
  sellable: z.boolean().optional(),
  sellPrice: z.number().int().min(0).optional().nullable(),
  availableUntil: z.string().datetime().optional().nullable(),
  gemsGiven: z.number().int().min(0).optional(),
  bugSizeMin: z.number().min(0.1).optional(),
  bugSizeMax: z.number().min(0.1).optional(),
  bugRarity: bugRarityEnum.optional().default('common'),
  bugActiveTime: bugActiveTimeEnum.optional().default('all_day'),
  bugSpawnOn: z.array(z.string().min(1).max(32)).optional(),
  bugScenes: z.array(z.string().min(1).max(64)).optional(),
  fishSizeMin: z.number().min(0.1).optional(),
  fishSizeMax: z.number().min(0.1).optional(),
  fishRarity: bugRarityEnum.optional().default('common'),
  fishActiveTime: bugActiveTimeEnum.optional().default('all_day'),
  fishSpotTypes: z.array(z.string().min(1).max(32)).optional(),
  lightRadius: z.number().min(0.5).optional(),
  lightColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  lightIntensity: z.number().min(0.1).max(1).optional(),
  npcDialog: z.array(z.object({
    text: z.string().min(1),
    highlight: z.object({
      type: z.enum(['hud_button', 'inventory_item', 'world_item', 'category_chip', 'shop_item', 'shop_category']),
      target: z.string().min(1),
    }).optional(),
  })).optional(),
});

const gameItemUpdateSchema = z.object({
  label: z.string().min(1).max(48).optional(),
  emoji: z.string().min(1).max(8).optional(),
  color: z.string().min(4).max(9).optional(),
  imageUrl: z.string().url().optional().or(z.literal('')),
  category: categoryEnum.optional(),
  subCategory: z.string().min(1).max(32).optional().nullable(),
  placeable: z.boolean().optional(),
  cols: z.number().int().min(1).max(50).optional(),
  rows: z.number().int().min(1).max(50).optional(),
  growthMs: z.number().int().min(0).optional().nullable(),
  harvestYield: z.array(z.object({
    itemType: z.string().min(1),
    qty: z.number().int().min(1),
  })).optional(),
  interactAction: z.object({
    type: z.enum(['open_scene', 'open_modal', 'start_dialog', 'none']),
    payload: z.string().optional(),
  }).optional().nullable(),
  autoConnect: z.boolean().optional(),
  centerOverflow: z.boolean().optional(),
  directionalImages: directionalImagesSchema.nullable(),
  buyable: z.boolean().optional(),
  gemPrice: z.number().int().min(0).optional(),
  farmLevel: z.number().int().min(0).optional().nullable(),
  petLevel: z.number().int().min(0).optional().nullable(),
  shopSection: z.string().min(1).max(32).optional().nullable(),
  sellable: z.boolean().optional(),
  sellPrice: z.number().int().min(0).optional().nullable(),
  availableUntil: z.string().datetime().optional().nullable(),
  gemsGiven: z.number().int().min(0).optional().nullable(),
  bugSizeMin: z.number().min(0.1).optional().nullable(),
  bugSizeMax: z.number().min(0.1).optional().nullable(),
  bugRarity: bugRarityEnum.optional().nullable(),
  bugActiveTime: bugActiveTimeEnum.optional().nullable(),
  bugSpawnOn: z.array(z.string().min(1).max(32)).optional().nullable(),
  bugScenes: z.array(z.string().min(1).max(64)).optional().nullable(),
  fishSizeMin: z.number().min(0.1).optional().nullable(),
  fishSizeMax: z.number().min(0.1).optional().nullable(),
  fishRarity: bugRarityEnum.optional().nullable(),
  fishActiveTime: bugActiveTimeEnum.optional().nullable(),
  fishSpotTypes: z.array(z.string().min(1).max(32)).optional().nullable(),
  lightRadius: z.number().min(0.5).optional().nullable(),
  lightColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  lightIntensity: z.number().min(0.1).max(1).optional().nullable(),
  npcDialog: z.array(z.object({
    text: z.string().min(1),
    highlight: z.object({
      type: z.enum(['hud_button', 'inventory_item', 'world_item', 'category_chip', 'shop_item', 'shop_category']),
      target: z.string().min(1),
    }).optional(),
  })).optional().nullable(),
});

const imageGenSchema = z.object({
  prompt: z.string().min(1).optional(),
  referenceItemType: z.string().min(1).optional(),
});

// ─── GET /admin/game-items — List all item definitions ──────────────────────

router.get(
  '/game-items',
  ...adminGuard,
  catchAsync(async (_req, res) => {
    const items = await GameItemDef.find().sort({ label: 1 }).lean();
    success(res, items);
  }),
);

// ─── POST /admin/game-items — Create a new item definition ─────────────────

router.post(
  '/game-items',
  ...adminGuard,
  validate({ body: gameItemBodySchema }),
  catchAsync(async (req, res) => {
    const existing = await GameItemDef.findOne({ itemType: req.body.itemType });
    if (existing) throw new AppError(`Item type "${req.body.itemType}" already exists`, 409, 'DUPLICATE_ITEM');

    const item = await GameItemDef.create(req.body);
    log.info({ admin: req.user?.id, itemType: item.itemType }, 'Game item created');

    await broadcastItemDefs();
    success(res, item.toObject(), 201);
  }),
);

// ─── PATCH /admin/game-items/:itemType — Update an existing item ────────────

router.patch(
  '/game-items/:itemType',
  ...adminGuard,
  validate({ body: gameItemUpdateSchema }),
  catchAsync(async (req, res) => {
    const { itemType } = req.params;
    const updateData = { ...req.body };

    // Allow clearing optional fields by setting to null
    if (updateData.growthMs === null) updateData.growthMs = undefined;
    if (updateData.interactAction === null) updateData.interactAction = undefined;
    if (updateData.subCategory === null) updateData.subCategory = undefined;
    if (updateData.shopSection === null) updateData.shopSection = undefined;
    if (updateData.sellPrice === null) updateData.sellPrice = undefined;
    if (updateData.availableUntil === null) updateData.availableUntil = undefined;
    if (updateData.farmLevel === null) updateData.farmLevel = undefined;
    if (updateData.petLevel === null) updateData.petLevel = undefined;
    if (updateData.gemsGiven === null) updateData.gemsGiven = undefined;
    if (updateData.bugSizeMin === null) updateData.bugSizeMin = undefined;
    if (updateData.bugSizeMax === null) updateData.bugSizeMax = undefined;
    if (updateData.bugRarity === null) updateData.bugRarity = undefined;
    if (updateData.bugActiveTime === null) updateData.bugActiveTime = undefined;
    if (updateData.bugSpawnOn === null) updateData.bugSpawnOn = undefined;
    if (updateData.bugScenes === null) updateData.bugScenes = undefined;
    if (updateData.fishSizeMin === null) updateData.fishSizeMin = undefined;
    if (updateData.fishSizeMax === null) updateData.fishSizeMax = undefined;
    if (updateData.fishRarity === null) updateData.fishRarity = undefined;
    if (updateData.fishActiveTime === null) updateData.fishActiveTime = undefined;
    if (updateData.fishSpotTypes === null) updateData.fishSpotTypes = undefined;
    if (updateData.lightRadius === null) updateData.lightRadius = undefined;
    if (updateData.lightColor === null) updateData.lightColor = undefined;
    if (updateData.lightIntensity === null) updateData.lightIntensity = undefined;
    if (updateData.npcDialog === null) updateData.npcDialog = undefined;
    if (updateData.availableUntil && typeof updateData.availableUntil === 'string') {
      updateData.availableUntil = new Date(updateData.availableUntil);
    }

    const item = await GameItemDef.findOneAndUpdate(
      { itemType },
      { $set: updateData },
      { new: true, runValidators: true },
    );
    if (!item) throw new AppError(`Item type "${itemType}" not found`, 404, 'ITEM_NOT_FOUND');

    log.info({ admin: req.user?.id, itemType }, 'Game item updated');

    await broadcastItemDefs();
    success(res, item.toObject());
  }),
);

// ─── DELETE /admin/game-items/:itemType — Delete an item definition ─────────

router.delete(
  '/game-items/:itemType',
  ...adminGuard,
  catchAsync(async (req, res) => {
    const { itemType } = req.params;
    const item = await GameItemDef.findOneAndDelete({ itemType });
    if (!item) throw new AppError(`Item type "${itemType}" not found`, 404, 'ITEM_NOT_FOUND');

    log.info({ admin: req.user?.id, itemType }, 'Game item deleted');

    await broadcastItemDefs();
    success(res, { deleted: true, itemType });
  }),
);

// ─── GET /admin/balloon-loot — Balloon loot pool config ──────────────────────

const balloonLootEntrySchema = z.object({
  itemType: z.string().min(1),
  rarity: z.enum(['common', 'rare', 'epic', 'unique', 'legendary', 'mythic']),
  weight: z.number().positive().optional(),
});

router.get(
  '/balloon-loot',
  ...adminGuard,
  catchAsync(async (req, res) => {
    const config = await BalloonLootConfig.findOne().lean();
    const entries = config?.entries ?? [];
    log.info({ admin: req.user?.id, count: entries.length, entries }, 'GET /balloon-loot: returning config');
    success(res, { entries });
  }),
);

// ─── PUT /admin/balloon-loot — Replace balloon loot pool ─────────────────────

router.put(
  '/balloon-loot',
  ...adminGuard,
  validate({ body: z.object({ entries: z.array(balloonLootEntrySchema) }) }),
  catchAsync(async (req, res) => {
    log.info({ admin: req.user?.id }, 'PUT /balloon-loot: request received');

    const bodyEntries = (req.body as { entries: Array<{ itemType: string; rarity: string; weight?: number }> }).entries;
    log.info({ admin: req.user?.id, rawCount: bodyEntries.length, rawEntries: bodyEntries }, 'PUT /balloon-loot: parsed body');

    const entries: IBalloonLootEntry[] = bodyEntries.map((e) => ({
      itemType: String(e.itemType).trim(),
      rarity: e.rarity,
      weight: e.weight ?? RARITY_WEIGHTS[e.rarity as keyof typeof RARITY_WEIGHTS],
    }));
    log.info({ admin: req.user?.id, entriesToSave: entries }, 'PUT /balloon-loot: calling findOneAndUpdate');

    const config = await BalloonLootConfig.findOneAndUpdate(
      {},
      { $set: { entries } },
      { new: true, upsert: true, runValidators: true },
    ).lean();
    if (!config) throw new AppError('Failed to save balloon loot config', 500, 'INTERNAL_ERROR');

    const outEntries: IBalloonLootEntry[] = (config.entries ?? []).map((e) => ({
      itemType: e.itemType,
      rarity: e.rarity as IBalloonLootEntry['rarity'],
      weight: e.weight,
    }));
    log.info({ admin: req.user?.id, count: outEntries.length, savedEntries: outEntries }, 'Balloon loot config updated');
    success(res, { entries: outEntries });
  }),
);

// ─── GET /admin/fossil-loot — Fossil loot pool config ────────────────────────

const fossilLootEntrySchema = z.object({
  itemType: z.string().min(1),
  rarity: z.enum(['common', 'rare', 'epic', 'unique', 'legendary', 'mythic']),
  weight: z.number().positive().optional(),
});

router.get(
  '/fossil-loot',
  ...adminGuard,
  catchAsync(async (req, res) => {
    const config = await FossilLootConfig.findOne().lean();
    const entries = config?.entries ?? [];
    log.info({ admin: req.user?.id, count: entries.length, entries }, 'GET /fossil-loot: returning config');
    success(res, { entries });
  }),
);

// ─── PUT /admin/fossil-loot — Replace fossil loot pool ────────────────────────

router.put(
  '/fossil-loot',
  ...adminGuard,
  validate({ body: z.object({ entries: z.array(fossilLootEntrySchema) }) }),
  catchAsync(async (req, res) => {
    log.info({ admin: req.user?.id }, 'PUT /fossil-loot: request received');

    const bodyEntries = (req.body as { entries: Array<{ itemType: string; rarity: string; weight?: number }> }).entries;
    const entries: IFossilLootEntry[] = bodyEntries.map((e) => ({
      itemType: String(e.itemType).trim(),
      rarity: e.rarity,
      weight: e.weight ?? RARITY_WEIGHTS[e.rarity as keyof typeof RARITY_WEIGHTS],
    }));

    const config = await FossilLootConfig.findOneAndUpdate(
      {},
      { $set: { entries } },
      { new: true, upsert: true, runValidators: true },
    ).lean();
    if (!config) throw new AppError('Failed to save fossil loot config', 500, 'INTERNAL_ERROR');

    const outEntries: IFossilLootEntry[] = (config.entries ?? []).map((e) => ({
      itemType: e.itemType,
      rarity: e.rarity as IFossilLootEntry['rarity'],
      weight: e.weight,
    }));
    log.info({ admin: req.user?.id, count: outEntries.length, savedEntries: outEntries }, 'Fossil loot config updated');
    success(res, { entries: outEntries });
  }),
);

// ─── Shared style prompt fragment ────────────────────────────────────────────

const STYLE_FRAGMENT =
  `Art style: flat vector illustration with thick uniform black outlines, ` +
  `soft cel-shaded coloring with one highlight and one shadow tone per surface, no gradients. ` +
  `Perspective: front-facing view, similar to stardew valley, centered in frame. ` +
  `Proportions: slightly chunky and rounded for a friendly, cute aesthetic. ` +
  `Lighting: soft diffused light from the upper left, no drop shadow. ` +
  `Transparent PNG background, no ground plane, no extra props or decorations. ` +
  `The asset should fill roughly 95% of the image.`;

const STYLE_FRAGMENT_FISH =
  `Art style: flat vector illustration with thick uniform black outlines, ` +
  `soft cel-shaded coloring with one highlight and one shadow tone per surface, no gradients. ` +
  `Perspective: side-facing view, swimming left, similar to stardew valley, centered in frame. ` +
  `Proportions: slightly chunky and rounded for a friendly, cute aesthetic. ` +
  `Lighting: soft diffused light from the upper left, no drop shadow. ` +
  `Transparent PNG background, no ground plane, no extra props or decorations. ` +
  `The asset should fill roughly 95% of the image.`;

const STYLE_FRAGMENT_CHAIRS =
  `Art style: flat vector illustration with thick uniform black outlines, ` +
  `soft cel-shaded coloring with one highlight and one shadow tone per surface, no gradients. ` +
  `Perspective: facing right, similar to stardew valley, centered in frame. ` +
  `Proportions: slightly chunky and rounded for a friendly, cute aesthetic. ` +
  `Lighting: soft diffused light from the upper left, no drop shadow. ` +
  `Transparent PNG background, no ground plane, no extra props or decorations. ` +
  `The asset should fill roughly 95% of the image.`;

const STYLE_FRAGMENT_FLOORING =
  `Art style: flat solid color base with subtle detail or texture. ` +
  `No gradients, no shadows, no tones, absolutely no black outlines. ` +
  `Flat top-down view, centered in frame. ` +
  `CRITICAL — SEAMLESS TILE: No borders, no frame, no drop shadow, no edge shadows. ` +
  `The pattern or texture must extend to all four edges of the image with no visible seam so tiles can be placed side by side. ` +
  `Transparent PNG background. The asset must fill the entire image area edge-to-edge for seamless tiling.`;

/**
 * Fence-variant prompt builder.
 *
 * Strategy: generate the POST first (standalone, no reference needed) using the
 * game's standard art style. Then use that post image as the reference for
 * the other 5 variants so the AI keeps the exact same design.
 */
function buildFencePrompts(itemName: string) {
  const style =
    `Art style: flat vector illustration with thick uniform black outlines, ` +
    `soft cel-shaded coloring with one highlight and one shadow tone, no gradients. ` +
    `Stardew valley inspired but not pixel art. Slightly chunky and rounded for a friendly cozy aesthetic. ` +
    `Transparent PNG background. This is a SQUARE TILE for a farming game grid.`;

  const tileRule =
    `CRITICAL LAYOUT RULE: The wooden post sits at the exact center of the square tile. ` +
    `The post should be 40% the width of the tile. ` +
    `Any rail/plank connections MUST extend ALL THE WAY from the post to the VERY EDGE of the image — ` +
    `touching the border of the square with zero gap — so that adjacent tiles connect seamlessly. ` +
    `Rails should be about 25% the width of the tile, made of horizontal wooden planks with the same outline style.`;

  const refPrefix =
    `The attached image is a ${itemName} post tile. Keep the EXACT same post design, colors, ` +
    `outline weight, and art style. Add wooden plank rail(s) as described below. ${tileRule}`;

  return {
    post: {
      needsRef: false,
      prompt:
        `A single ${itemName} post tile for a cozy farming mobile game. ${style} ` +
        `Show ONLY one short upright wooden post, centered in the tile. ` +
        `No planks, no rails, no beams — just one isolated post. ` +
        `The post should fill about 35-40% of the tile width. ${tileRule}`,
    },
    end: {
      needsRef: true,
      prompt:
        `${refPrefix} ` +
        `DEAD-END: Add ONE plank rail from the center post to the TOP EDGE of the tile (north). ` +
        `The rail must touch the very top border of the image. No rails on the other 3 sides.`,
    },
    straight: {
      needsRef: true,
      prompt:
        `${refPrefix} ` +
        `STRAIGHT: Add plank rails from the center post to BOTH the TOP EDGE (north) and BOTTOM EDGE (south). ` +
        `Both rails must touch the very edge of the image. No rails east or west.`,
    },
    corner: {
      needsRef: true,
      prompt:
        `${refPrefix} ` +
        `CORNER: Add plank rails from the center post to the TOP EDGE (north) and RIGHT EDGE (east). ` +
        `Both rails must touch the very edge of the image. No rails south or west. Forms an L shape.`,
    },
    tJunction: {
      needsRef: true,
      prompt:
        `${refPrefix} ` +
        `T-JUNCTION: Add plank rails from the center post to the TOP EDGE (north), RIGHT EDGE (east), ` +
        `and BOTTOM EDGE (south). All three rails must touch the very edge. No rail to the west. Forms a T shape.`,
    },
    cross: {
      needsRef: true,
      prompt:
        `${refPrefix} ` +
        `CROSSROADS: Add plank rails from the center post to ALL FOUR EDGES — ` +
        `top (north), right (east), bottom (south), left (west). ` +
        `All four rails must touch the very edge of the image. Forms a + shape.`,
    },
  };
}

// ─── POST /admin/game-items/:itemType/generate-image ────────────────────────

router.post(
  '/game-items/:itemType/generate-image',
  ...adminGuard,
  validate({ body: imageGenSchema }),
  catchAsync(async (req, res) => {
    const { itemType } = req.params;
    const item = await GameItemDef.findOne({ itemType });
    if (!item) throw new AppError(`Item type "${itemType}" not found`, 404, 'ITEM_NOT_FOUND');

    const itemName = item.label.toLowerCase();

    // ── Auto-connect items (fences): generate 6 directional variants ──────
    if (item.autoConnect) {
      const prompts = buildFencePrompts(itemName);
      const allKeys = ['post', 'end', 'straight', 'corner', 'tJunction', 'cross'] as const;

      log.info({ admin: req.user?.id, itemType }, 'Generating fence images — post first, then 5 variants from reference');

      // Step 1: Generate the standalone post (no reference needed)
      const postDataUri = await openAIService.generateImageBase64(prompts.post.prompt, {
        model: 'gpt-image-1',
        size: '1024x1024',
        quality: 'medium',
        background: 'transparent',
      });
      const postRawBase64 = postDataUri.replace(/^data:image\/\w+;base64,/, '');

      // Step 2: Upload post + generate the other 5 using the post as reference (in parallel)
      const refVariants = allKeys.filter((k) => k !== 'post');
      const [postUrl, ...variantDataUris] = await Promise.all([
        storageService.uploadBase64(postDataUri, `game-items/${itemType}/post`),
        ...refVariants.map((v) =>
          openAIService.editImageBase64(postRawBase64, prompts[v].prompt, {
            size: '1024x1024',
            quality: 'medium',
            background: 'transparent',
          }),
        ),
      ]);

      // Step 3: Upload the 5 variant images in parallel
      const variantUrls = await Promise.all(
        refVariants.map((v, i) =>
          storageService.uploadBase64(variantDataUris[i], `game-items/${itemType}/${v}`),
        ),
      );

      const directionalImages: Record<string, string> = { post: postUrl };
      refVariants.forEach((v, i) => { directionalImages[v] = variantUrls[i]; });

      item.imageUrl = postUrl;
      item.directionalImages = directionalImages as any;
      await item.save();

      log.info({ admin: req.user?.id, itemType, directionalImages }, 'Fence images generated & saved');
      await broadcastItemDefs();
      return success(res, { directionalImages, imageUrl: postUrl, item: item.toObject() });
    }

    // ── Standard single-image generation ──────────────────────────────────
    const styleFragment =
      item.category === 'tiled_flooring' ? STYLE_FRAGMENT_FLOORING
      : item.category === 'fish' ? STYLE_FRAGMENT_FISH
      : item.subCategory === 'chairs' ? STYLE_FRAGMENT_CHAIRS
      : STYLE_FRAGMENT;
    const prompt = req.body.prompt ??
      `A single ${itemName}, 2D game sprite for a cozy top-down farming game. ${styleFragment}`;

    const referenceItemType = req.body.referenceItemType as string | undefined;
    const isTiledFlooring = item.category === 'tiled_flooring';
    const imageOpts = {
      size: '1024x1024' as const,
      quality: (isTiledFlooring ? 'high' : 'medium') as 'high' | 'medium',
      background: 'transparent' as const,
    };

    let base64DataUri: string;

    if (referenceItemType) {
      const refItem = await GameItemDef.findOne({ itemType: referenceItemType }).lean();
      if (!refItem?.imageUrl) {
        throw new AppError(`Reference item "${referenceItemType}" has no image`, 400, 'REFERENCE_IMAGE_REQUIRED');
      }
      const imageRes = await fetch(refItem.imageUrl);
      if (!imageRes.ok) {
        throw new AppError('Failed to fetch reference image', 502, 'FETCH_IMAGE_FAILED');
      }
      const arrayBuffer = await imageRes.arrayBuffer();
      const refBase64 = Buffer.from(arrayBuffer).toString('base64');
      log.info({ admin: req.user?.id, itemType, referenceItemType }, 'Generating game item image with reference');
      base64DataUri = await openAIService.editImageBase64(refBase64, prompt, {
        ...imageOpts,
        inputFidelity: 'high',
      });
    } else {
      log.info({ admin: req.user?.id, itemType, prompt }, 'Generating game item image');
      base64DataUri = await openAIService.generateImageBase64(prompt, {
        model: 'gpt-image-1',
        ...imageOpts,
      });
    }

    const imageUrl = await storageService.uploadBase64(base64DataUri, `game-items/${itemType}`);
    item.imageUrl = imageUrl;
    await item.save();

    log.info({ admin: req.user?.id, itemType, imageUrl }, 'Game item image generated & saved');

    await broadcastItemDefs();
    success(res, { imageUrl, item: item.toObject() });
  }),
);

// ═════════════════════════════════════════════════════════════════════════════
// Shop Banner Admin CRUD
// ═════════════════════════════════════════════════════════════════════════════

const shopBannerBodySchema = z.object({
  key: z.string().min(1).max(32).regex(/^[a-z0-9_]+$/, 'Lowercase alphanumeric + underscores'),
  label: z.string().min(1).max(48),
  imageUrl: z.string().url().optional().or(z.literal('')),
  displayImage: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  shopSection: z.string().max(32).optional(),
});

const shopBannerUpdateSchema = z.object({
  label: z.string().min(1).max(48).optional(),
  imageUrl: z.string().url().optional().or(z.literal('')),
  displayImage: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  shopSection: z.string().max(32).optional(),
});

const bannerImageGenSchema = z.object({
  prompt: z.string().min(1).optional(),
});

/** Cozy banner art style used for shop section images. */
const BANNER_STYLE =
  `Art style: cozy, soft pastel colors, rounded bubbly shapes, warm and inviting. ` +
  `Flat illustration, no heavy shadows. Suitable for a cute mobile game shop banner. ` +
  `Wide landscape format — the image will be cropped/displayed as a horizontal banner. ` +
  `No text or letters in the image.`;

/**
 * GET /admin/shop-banners — List all shop banners
 */
router.get(
  '/shop-banners',
  ...adminGuard,
  catchAsync(async (_req, res) => {
    const banners = await ShopBanner.find().sort({ sortOrder: 1 }).lean();
    success(res, banners);
  }),
);

/**
 * POST /admin/shop-banners — Create a shop banner
 */
router.post(
  '/shop-banners',
  ...adminGuard,
  validate({ body: shopBannerBodySchema }),
  catchAsync(async (req, res) => {
    const shopSection = req.body.shopSection ?? null;
    const existing = await ShopBanner.findOne({ key: req.body.key, shopSection });
    if (existing) throw new AppError(`Banner key "${req.body.key}" already exists in this shop`, 409, 'DUPLICATE_BANNER');

    const banner = await ShopBanner.create({
      ...req.body,
      shopSection: req.body.shopSection || undefined,
      imageUrl: req.body.imageUrl || undefined,
      displayImage: req.body.displayImage ?? false,
    });
    log.info({ admin: req.user?.id, key: banner.key }, 'Shop banner created');
    success(res, banner.toObject(), 201);
  }),
);

/**
 * PATCH /admin/shop-banners/:id — Update a shop banner
 */
router.patch(
  '/shop-banners/:id',
  ...adminGuard,
  validate({ body: shopBannerUpdateSchema }),
  catchAsync(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) throw new AppError('Invalid banner id', 400, 'INVALID_ID');
    const update = { ...req.body };
    if (update.shopSection === '') update.shopSection = undefined;
    const banner = await ShopBanner.findByIdAndUpdate(id, { $set: update }, { new: true, runValidators: true });
    if (!banner) throw new AppError('Banner not found', 404, 'BANNER_NOT_FOUND');
    log.info({ admin: req.user?.id, key: banner.key }, 'Shop banner updated');
    success(res, banner.toObject());
  }),
);

/**
 * DELETE /admin/shop-banners/:id — Delete a shop banner
 */
router.delete(
  '/shop-banners/:id',
  ...adminGuard,
  catchAsync(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) throw new AppError('Invalid banner id', 400, 'INVALID_ID');
    const banner = await ShopBanner.findByIdAndDelete(id);
    if (!banner) throw new AppError('Banner not found', 404, 'BANNER_NOT_FOUND');
    log.info({ admin: req.user?.id, key: banner.key }, 'Shop banner deleted');
    success(res, { deleted: true, id });
  }),
);

/**
 * POST /admin/shop-banners/:id/generate-image — Generate banner image via AI
 */
router.post(
  '/shop-banners/:id/generate-image',
  ...adminGuard,
  validate({ body: bannerImageGenSchema }),
  catchAsync(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) throw new AppError('Invalid banner id', 400, 'INVALID_ID');
    const banner = await ShopBanner.findById(id);
    if (!banner) throw new AppError('Banner not found', 404, 'BANNER_NOT_FOUND');

    const defaultPrompt = `A cozy, warm horizontal banner illustration for a "${banner.label}" section in a cute farming game shop. Pastel colors, soft rounded shapes, seasonal or themed decorative elements. ${BANNER_STYLE}`;
    const prompt = req.body.prompt ?? defaultPrompt;

    log.info({ admin: req.user?.id, key: banner.key, prompt }, 'Generating shop banner image');

    const base64DataUri = await openAIService.generateImageBase64(prompt, {
      model: 'gpt-image-1',
      size: '1536x1024',
      quality: 'medium',
    });

    const imageUrl = await storageService.uploadBase64(base64DataUri, `shop-banners/${banner.key}`);
    banner.imageUrl = imageUrl;
    banner.displayImage = true;
    await banner.save();

    log.info({ admin: req.user?.id, key: banner.key, imageUrl }, 'Shop banner image generated & saved');
    success(res, { imageUrl, banner: banner.toObject() });
  }),
);

// ═════════════════════════════════════════════════════════════════════════════
// Scenery Bake Admin
// ═════════════════════════════════════════════════════════════════════════════

const sceneryOverridesSchema = z.object({
  outerBushType: z.string().min(1).optional(),
  treeTypes: z.array(z.string().min(1)).optional(),
}).optional();

const sceneryBakeSchema = z.object({
  farmCols: z.number().int().min(8).max(64),
  farmRows: z.number().int().min(8).max(64),
});

const sceneryPrecomputeSchema = sceneryBakeSchema.extend({
  overrides: sceneryOverridesSchema,
});

router.get(
  '/scenery',
  ...adminGuard,
  catchAsync(async (_req, res) => {
    const bakes = await sceneryBakeService.listAll();
    success(res, { bakes, farmLevels: FARM_LEVELS });
  }),
);

router.post(
  '/scenery/bake',
  ...adminGuard,
  validate({ body: sceneryBakeSchema }),
  catchAsync(async (req, res) => {
    const { farmCols, farmRows } = req.body;
    log.info({ admin: req.user?.id, farmCols, farmRows }, 'Admin triggered scenery bake');
    const result = await sceneryBakeService.bake(farmCols, farmRows);

    getIO().emit(WS_EVENTS.SCENERY_UPDATED, { farmCols, farmRows, imageUrl: result.imageUrl });

    success(res, result);
  }),
);

router.post(
  '/scenery/precompute',
  ...adminGuard,
  validate({ body: sceneryPrecomputeSchema }),
  catchAsync(async (req, res) => {
    const { farmCols, farmRows, overrides } = req.body;
    log.info({ admin: req.user?.id, farmCols, farmRows }, 'Admin requested precomputed placements');
    const placements = await sceneryBakeService.precomputePlacements(farmCols, farmRows, overrides);
    success(res, { placements, farmCols, farmRows });
  }),
);

// ═════════════════════════════════════════════════════════════════════════════
// Scene Admin CRUD
// ═════════════════════════════════════════════════════════════════════════════

const scenePlacementSchema = z.object({
  id: z.string().min(1),
  itemType: z.string().min(1),
  x: z.number(),
  y: z.number(),
  scale: z.number().min(0.1).max(5).default(1),
  depthOffset: z.number().optional(),
});

const walkableRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
}).nullable().optional();

const unwalkableTileSchema = z.object({
  col: z.number().int().min(0),
  row: z.number().int().min(0),
});
const unwalkableTilesSchema = z.array(unwalkableTileSchema).optional();

const fishingTileSchema = z.object({
  col: z.number().int().min(0),
  row: z.number().int().min(0),
  spotType: z.string().min(1).max(24).default('general'),
});
const fishingTilesSchema = z.array(fishingTileSchema).optional();

const sceneCreateSchema = z.object({
  name: z.string().min(1).max(64),
  slug: z.string().min(1).max(48).regex(/^[a-z0-9_]+$/, 'Lowercase alphanumeric + underscores'),
  cols: z.number().int().min(8).max(128),
  rows: z.number().int().min(8).max(128),
  bgColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#7EC87E'),
  tiledFlooringItemType: z.string().min(1).max(64).optional().nullable(),
  grassNoiseStrength: z.number().min(0).max(0.2).default(0.04),
  farmCols: z.number().int().min(4).max(64),
  farmRows: z.number().int().min(4).max(64),
  walkableRect: walkableRectSchema,
  unwalkableTiles: unwalkableTilesSchema,
  fishingTiles: fishingTilesSchema,
  spawnX: z.number().optional(),
  spawnY: z.number().optional(),
});

const sceneUpdateSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  cols: z.number().int().min(8).max(128).optional(),
  rows: z.number().int().min(8).max(128).optional(),
  bgColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  tiledFlooringItemType: z.string().min(1).max(64).optional().nullable(),
  grassNoiseStrength: z.number().min(0).max(0.2).optional(),
  farmCols: z.number().int().min(4).max(64).optional(),
  farmRows: z.number().int().min(4).max(64).optional(),
  placements: z.array(scenePlacementSchema).optional(),
  walkableRect: walkableRectSchema,
  unwalkableTiles: unwalkableTilesSchema,
  fishingTiles: fishingTilesSchema,
  spawnX: z.number().optional(),
  spawnY: z.number().optional(),
});

router.get(
  '/scenes',
  ...adminGuard,
  catchAsync(async (_req, res) => {
    const [scenes, bakes] = await Promise.all([
      Scene.find().sort({ name: 1 }).lean(),
      sceneryBakeService.listAll(),
    ]);
    success(res, { scenes, farmLevels: FARM_LEVELS, bakes });
  }),
);

router.get(
  '/scenes/:slug',
  ...adminGuard,
  catchAsync(async (req, res) => {
    const scene = await Scene.findOne({ slug: req.params.slug }).lean();
    if (!scene) throw new AppError(`Scene "${req.params.slug}" not found`, 404, 'SCENE_NOT_FOUND');
    success(res, scene);
  }),
);

router.post(
  '/scenes',
  ...adminGuard,
  validate({ body: sceneCreateSchema }),
  catchAsync(async (req, res) => {
    const existing = await Scene.findOne({ slug: req.body.slug });
    if (existing) throw new AppError(`Scene slug "${req.body.slug}" already exists`, 409, 'DUPLICATE_SCENE');
    const scene = await Scene.create(req.body);
    log.info({ admin: req.user?.id, slug: scene.slug }, 'Scene created');
    success(res, scene.toObject(), 201);
  }),
);

router.patch(
  '/scenes/:slug',
  ...adminGuard,
  validate({ body: sceneUpdateSchema }),
  catchAsync(async (req, res) => {
    const current = await Scene.findOne({ slug: req.params.slug }).lean();
    if (!current) throw new AppError(`Scene "${req.params.slug}" not found`, 404, 'SCENE_NOT_FOUND');

    const update: Record<string, unknown> = { ...req.body };
    const dimsChanged =
      ('farmCols' in req.body && req.body.farmCols !== current.farmCols) ||
      ('farmRows' in req.body && req.body.farmRows !== current.farmRows);
    const tiledFlooringChanged =
      ('tiledFlooringItemType' in req.body && req.body.tiledFlooringItemType !== (current as any).tiledFlooringItemType);
    if (dimsChanged || tiledFlooringChanged) update.bakedImageUrl = null;

    const scene = await Scene.findOneAndUpdate(
      { slug: req.params.slug },
      { $set: update },
      { new: true, runValidators: true },
    );
    if (!scene) throw new AppError(`Scene "${req.params.slug}" not found`, 404, 'SCENE_NOT_FOUND');
    await multiplayerManager.invalidateSceneConfig(scene.slug);
    log.info({ admin: req.user?.id, slug: scene.slug }, 'Scene updated');
    success(res, scene.toObject());
  }),
);

router.delete(
  '/scenes/:slug',
  ...adminGuard,
  catchAsync(async (req, res) => {
    const scene = await Scene.findOneAndDelete({ slug: req.params.slug });
    if (!scene) throw new AppError(`Scene "${req.params.slug}" not found`, 404, 'SCENE_NOT_FOUND');
    log.info({ admin: req.user?.id, slug: scene.slug }, 'Scene deleted');
    success(res, { deleted: true, slug: req.params.slug });
  }),
);

router.post(
  '/scenes/:slug/bake',
  ...adminGuard,
  catchAsync(async (req, res) => {
    const scene = await Scene.findOne({ slug: req.params.slug });
    if (!scene) throw new AppError(`Scene "${req.params.slug}" not found`, 404, 'SCENE_NOT_FOUND');

    log.info({ admin: req.user?.id, slug: scene.slug }, 'Baking scene');
    const result = await sceneryBakeService.bakeScene(scene);
    scene.bakedImageUrl = result.imageUrl;
    await scene.save();

    // Do NOT update BakedScenery here. Scene bakes use scene.cols × scene.rows, which
    // can differ from procedural world size (farmCols + 2*WORLD_PADDING). BakedScenery
    // is for single-player farm and expects procedural dimensions. Farm scene bakes
    // are only used in multiplayer via scene.bakedImageUrl.

    success(res, { imageUrl: result.imageUrl });
  }),
);

// ─── Admin: Action Payloads ──────────────────────────────────────────────────

router.get(
  '/action-payloads',
  ...adminGuard,
  catchAsync(async (_req, res) => {
    const payloads = await GameItemDef.distinct('interactAction.payload', {
      'interactAction.payload': { $exists: true, $ne: '' },
    });
    success(res, { payloads: payloads.sort() });
  }),
);

// ─── Admin: Quest Action Types (dynamic, from trackAction call sites) ─────────

const QUEST_ACTION_TYPES = [
  'harvest', 'place', 'remove', 'water', 'catch', 'purchase', 'pop_balloon',
] as const;

router.get(
  '/quest-action-types',
  ...adminGuard,
  catchAsync(async (_req, res) => {
    success(res, { actions: [...QUEST_ACTION_TYPES] });
  }),
);

// ─── Admin: Equip Slots (for equip requirement) ───────────────────────────────

const EQUIP_SLOTS = ['handTool', 'bobber', 'bait', 'chair'] as const;

router.get(
  '/quest-equip-slots',
  ...adminGuard,
  catchAsync(async (_req, res) => {
    success(res, { slots: [...EQUIP_SLOTS] });
  }),
);

// ─── Admin: Quests ──────────────────────────────────────────────────────────

const questRequirementSchema = z.object({
  items: z.array(z.object({ itemType: z.string().min(1), qty: z.number().int().min(1) })).optional(),
  buildings: z.array(z.object({ itemType: z.string().min(1), count: z.number().int().min(1) })).optional(),
  actions: z.array(z.object({ action: z.string().min(1), count: z.number().int().min(1), itemType: z.string().min(1).optional() })).optional(),
  equips: z.array(z.object({ slot: z.string().min(1), itemType: z.string().min(1).optional(), count: z.number().int().min(1).optional() })).optional(),
  talk_to_npc: z.array(z.object({ npcItemType: z.string().min(1), count: z.number().int().min(1).optional() })).optional(),
  crop_grown: z.array(z.object({ itemType: z.string().min(1), count: z.number().int().min(1).optional() })).optional(),
  open_modal: z.array(z.object({ payload: z.string().min(1), count: z.number().int().min(1).optional() })).optional(),
});

const questRewardSchema = z.object({
  items: z.array(z.object({ itemType: z.string().min(1), qty: z.number().int().min(1) })).optional(),
  gems: z.number().int().min(0).optional(),
  xp: z.number().int().min(0).optional(),
});

const dialogHighlightSchema = z.object({
  type: z.enum(['hud_button', 'inventory_item', 'world_item', 'category_chip', 'shop_item', 'shop_category']),
  target: z.string().min(1),
});

const dialogStepSchema = z.object({
  text: z.string().min(1).max(500),
  highlight: dialogHighlightSchema.optional(),
  blocking: z.boolean().optional(),
  speaker: z.enum(['pet', 'npc']).optional(),
});

const questTriggerSchema = z.object({
  type: z.enum(['quest_complete', 'talk_to_npc', 'enter_scene', 'manual', 'start']),
  questId: z.string().max(64).optional(),
  npcItemType: z.string().max(64).optional(),
  sceneSlug: z.string().max(64).optional(),
  firstVisitOnly: z.boolean().optional(),
});

const questStepSchema = z.object({
  stepId: z.string().min(1).max(64),
  requirements: questRequirementSchema.default({}),
  dialogBefore: z.array(dialogStepSchema).optional(),
  dialogAfter: z.array(dialogStepSchema).optional(),
  blocking: z.boolean().optional(),
  rewards: questRewardSchema.optional(),
  nextStepId: z.string().max(64).optional(),
});

const createQuestSchema = z.object({
  questId: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
  type: z.enum(['farm_upgrade', 'story', 'daily']),
  title: z.string().min(1).max(128),
  description: z.string().max(512).default(''),
  farmLevel: z.number().int().min(2).max(20).optional(),
  petLevelMin: z.number().int().min(1).optional(),
  farmLevelMin: z.number().int().min(1).optional(),
  requiredQuestId: z.string().max(64).optional(),
  requirements: questRequirementSchema.default({}),
  rewards: questRewardSchema.default({}),
  sortOrder: z.number().int().default(0),
  startDialog: z.array(dialogStepSchema).optional(),
  endDialog: z.array(dialogStepSchema).optional(),
  startDialogSpeaker: z.enum(['pet', 'npc']).optional(),
  endDialogSpeaker: z.enum(['pet', 'npc']).optional(),
  autoTrigger: z.string().max(64).optional(),
  triggers: z.array(questTriggerSchema).optional(),
  steps: z.array(questStepSchema).optional(),
});

const updateQuestSchema = z.object({
  type: z.enum(['farm_upgrade', 'story', 'daily']).optional(),
  title: z.string().min(1).max(128).optional(),
  description: z.string().max(512).optional(),
  farmLevel: z.number().int().min(2).max(20).optional(),
  petLevelMin: z.number().int().min(1).optional().nullable(),
  farmLevelMin: z.number().int().min(1).optional().nullable(),
  requiredQuestId: z.string().max(64).optional().nullable(),
  requirements: questRequirementSchema.optional(),
  rewards: questRewardSchema.optional(),
  sortOrder: z.number().int().optional(),
  startDialog: z.array(dialogStepSchema).optional(),
  endDialog: z.array(dialogStepSchema).optional(),
  startDialogSpeaker: z.enum(['pet', 'npc']).optional().nullable(),
  endDialogSpeaker: z.enum(['pet', 'npc']).optional().nullable(),
  autoTrigger: z.string().max(64).optional().nullable(),
  triggers: z.array(questTriggerSchema).optional().nullable(),
  steps: z.array(questStepSchema).optional().nullable(),
});

router.get(
  '/quests',
  ...adminGuard,
  catchAsync(async (_req, res) => {
    const quests = await QuestDef.find().sort({ sortOrder: 1, questId: 1 }).lean();
    success(res, { quests });
  }),
);

router.post(
  '/quests',
  ...adminGuard,
  validate({ body: createQuestSchema }),
  catchAsync(async (req, res) => {
    const existing = await QuestDef.findOne({ questId: req.body.questId }).lean();
    if (existing) throw new AppError('Quest ID already exists', 409, 'QUEST_EXISTS');
    const quest = await QuestDef.create(req.body);
    log.info({ admin: req.user?.id, questId: quest.questId }, 'Quest created');
    success(res, quest, 201);
  }),
);

router.patch(
  '/quests/:questId',
  ...adminGuard,
  validate({ body: updateQuestSchema }),
  catchAsync(async (req, res) => {
    const quest = await QuestDef.findOneAndUpdate(
      { questId: req.params.questId },
      { $set: req.body },
      { new: true },
    );
    if (!quest) throw new AppError('Quest not found', 404, 'QUEST_NOT_FOUND');
    log.info({ admin: req.user?.id, questId: quest.questId }, 'Quest updated');
    success(res, quest);
  }),
);

router.delete(
  '/quests/:questId',
  ...adminGuard,
  catchAsync(async (req, res) => {
    const result = await QuestDef.deleteOne({ questId: req.params.questId });
    if (result.deletedCount === 0) throw new AppError('Quest not found', 404, 'QUEST_NOT_FOUND');
    log.info({ admin: req.user?.id, questId: req.params.questId }, 'Quest deleted');
    success(res, { deleted: true });
  }),
);

// ─── Admin: My Farm (self-service for admins) ─────────────────────────────────

const updateMyFarmSchema = {
  body: z.object({
    gems: z.number().min(0).optional(),
    farmLevel: z.number().min(1).max(8).optional(),
  }),
};

/** POST /admin/my-farm/reset-quests - Delete all UserQuest docs for current user. */
router.post(
  '/my-farm/reset-quests',
  ...adminGuard,
  catchAsync(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    const result = await UserQuest.deleteMany({ userId });
    log.info({ admin: userId }, 'Admin reset own quests');
    success(res, { deleted: result.deletedCount });
  }),
);

/** POST /admin/my-farm/reset-farm - Delete Farm doc for current user. */
router.post(
  '/my-farm/reset-farm',
  ...adminGuard,
  catchAsync(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    await Farm.deleteOne({ userId });
    log.info({ admin: userId }, 'Admin reset own farm');
    success(res, { ok: true });
  }),
);

/** PATCH /admin/my-farm - Update gems and/or farm level for current user. */
router.patch(
  '/my-farm',
  ...adminGuard,
  validate(updateMyFarmSchema),
  catchAsync(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    const { gems, farmLevel } = (req as any).body;

    let farm = await Farm.findOne({ userId });
    if (!farm) {
      farm = await farmService.loadOrCreateFarm(userId);
    }

    if (typeof gems === 'number') {
      farm.gems = gems;
      farm.markModified('gems');
    }
    if (typeof farmLevel === 'number') {
      const lvlDef = FARM_LEVELS.find((l) => l.level === farmLevel);
      if (lvlDef) {
        farm.xp = lvlDef.xpRequired;
        farm.markModified('xp');
        for (let l = 2; l <= farmLevel; l++) {
          await UserQuest.findOneAndUpdate(
            { userId, questId: `farm_upgrade_${l}` },
            { $set: { status: 'completed' } },
            { upsert: true },
          );
        }
      }
    }

    await farm.save();
    const effectiveLevel = await farmService.resolveFarmLevel(userId, farm.xp);
    log.info({ admin: userId, gems: farm.gems, farmLevel: effectiveLevel?.level }, 'Admin updated own farm');
    success(res, {
      farmXp: farm.xp,
      gems: farm.gems,
      farmLevel: effectiveLevel?.level ?? 1,
    });
  }),
);

// ═════════════════════════════════════════════════════════════════════════════
// Recipe Admin CRUD
// ═════════════════════════════════════════════════════════════════════════════

const recipeBodySchema = z.object({
  recipeId: z.string().min(1).max(48).regex(/^[a-z0-9_]+$/, 'Lowercase alphanumeric + underscores'),
  label: z.string().min(1).max(64),
  resultItemType: z.string().min(1),
  resultQty: z.number().int().min(1).optional(),
  ingredients: z.array(z.object({ itemType: z.string().min(1), qty: z.number().int().min(1) })).min(1).max(4),
  difficulty: z.number().int().min(1).max(5).optional(),
  recipeType: z.enum(['cooking', 'crafting']).optional(),
  sortOrder: z.number().int().optional(),
});

const recipeUpdateSchema = recipeBodySchema.partial().omit({ recipeId: true });

router.get(
  '/recipes',
  ...adminGuard,
  catchAsync(async (_req, res) => {
    const recipes = await Recipe.find().sort({ sortOrder: 1 }).lean();
    success(res, recipes);
  }),
);

router.post(
  '/recipes',
  ...adminGuard,
  validate({ body: recipeBodySchema }),
  catchAsync(async (req, res) => {
    const existing = await Recipe.findOne({ recipeId: req.body.recipeId });
    if (existing) throw new AppError(`Recipe "${req.body.recipeId}" already exists`, 409, 'RECIPE_EXISTS');
    const recipe = await Recipe.create(req.body);
    log.info({ admin: req.user?.id, recipeId: recipe.recipeId }, 'Recipe created');
    success(res, recipe.toObject(), 201);
  }),
);

router.patch(
  '/recipes/:recipeId',
  ...adminGuard,
  validate({ body: recipeUpdateSchema }),
  catchAsync(async (req, res) => {
    const recipe = await Recipe.findOne({ recipeId: req.params.recipeId });
    if (!recipe) throw new AppError(`Recipe "${req.params.recipeId}" not found`, 404, 'RECIPE_NOT_FOUND');
    Object.assign(recipe, req.body);
    await recipe.save();
    log.info({ admin: req.user?.id, recipeId: recipe.recipeId }, 'Recipe updated');
    success(res, recipe.toObject());
  }),
);

router.delete(
  '/recipes/:recipeId',
  ...adminGuard,
  catchAsync(async (req, res) => {
    const recipe = await Recipe.findOneAndDelete({ recipeId: req.params.recipeId });
    if (!recipe) throw new AppError(`Recipe "${req.params.recipeId}" not found`, 404, 'RECIPE_NOT_FOUND');
    log.info({ admin: req.user?.id, recipeId: req.params.recipeId }, 'Recipe deleted');
    success(res, { deleted: true });
  }),
);

// ═════════════════════════════════════════════════════════════════════════════
// Admin Mail
// ═════════════════════════════════════════════════════════════════════════════

const adminMailSchema = z.object({
  toUserId: z.string().min(1).optional(),
  subject: z.string().min(1, 'Subject is required').max(200),
  body: z.string().min(1, 'Body is required').max(2000),
  attachedItems: z
    .array(z.object({ itemType: z.string().min(1), qty: z.number().int().min(1) }))
    .optional()
    .default([]),
});

/** GET /admin/users/search?q= — Search users by ID or username (admin only). */
router.get(
  '/users/search',
  ...adminGuard,
  catchAsync(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return success(res, []);
    const orConditions: object[] = [{ username: { $regex: q, $options: 'i' } }];
    if (mongoose.Types.ObjectId.isValid(q) && String(new mongoose.Types.ObjectId(q)) === q) {
      orConditions.push({ _id: new mongoose.Types.ObjectId(q) });
    }
    const users = await User.find({ $or: orConditions })
      .select('_id username')
      .limit(20)
      .lean();
    success(res, users.map((u) => ({ id: u._id.toString(), username: u.username ?? u._id.toString() })));
  }),
);

/** Broadcast: toUserId omitted. Send to user: toUserId required. */
router.post(
  '/mail/send',
  ...adminGuard,
  validate({ body: adminMailSchema }),
  catchAsync(async (req, res) => {
    const adminId = req.user?._id?.toString();
    if (!adminId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const { toUserId, subject, body, attachedItems } = req.body;
    try {
      if (toUserId) {
        const mail = await mailService.sendToUser(adminId, toUserId, subject, body, attachedItems ?? []);
        log.info({ admin: adminId, toUserId, subject: subject.slice(0, 30) }, 'Admin mail sent to user');
        success(res, { mail });
      } else {
        const mail = await mailService.sendBroadcast(adminId, subject, body, attachedItems ?? []);
        log.info({ admin: adminId, subject: subject.slice(0, 30) }, 'Admin broadcast mail sent');
        success(res, { mail });
      }
    } catch (err) {
      throw new AppError(err instanceof Error ? err.message : 'Failed to send mail', 400, 'MAIL_SEND_FAILED');
    }
  }),
);

export default router;
