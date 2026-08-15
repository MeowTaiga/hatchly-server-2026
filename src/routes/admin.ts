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
import { Shop } from '../models/Shop.js';
import { openAIService } from '../services/OpenAIService.js';
import { storageService } from '../services/StorageService.js';
import { sceneryBakeService } from '../services/SceneryBakeService.js';
import { Scene } from '../models/Scene.js';
import { BakedScenery } from '../models/BakedScenery.js';
import { QuestDef } from '../models/QuestDef.js';
import { UserQuest } from '../models/UserQuest.js';
import { Recipe } from '../models/Recipe.js';
import { farmService, FARM_LEVELS } from '../services/FarmService.js';
import { resetGameAccount } from '../services/GameAccountResetService.js';
import {
  ACTION_LABELS,
  DIALOG_HIGHLIGHT_TYPES,
  EQUIP_SLOTS,
  HUD_BUTTON_TARGETS,
  QUEST_ACTIONS,
  QUEST_TRIGGER_TYPES,
  QUEST_TYPES,
} from '../services/quests/constants.js';
import { lintAllQuests, validateQuest, type QuestDraft, type QuestProblem } from '../services/quests/validate.js';
import { invalidateItemLabelCache, questService } from '../services/quests/index.js';
import { ensureCompoundTreeDefs } from '../services/TreeService.js';
import { getIO } from '../websocket/index.js';
import { WS_EVENTS } from '../websocket/events.js';
import { multiplayerManager } from '../services/MultiplayerManager.js';
import { mailService } from '../services/MailService.js';
import { spawnStressTestBots, removeStressTestBots } from '../services/StressTestBotManager.js';
import { resetSpiritSnatchCooldown } from '../services/SpiritSnatchService.js';
import getImageColors from 'get-image-colors';


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
  // Quest checklists label themselves from item defs, so a rename has to reach them.
  invalidateItemLabelCache();
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

/** Shared by create/update — quest-style live gates on tap actions. */
const interactActionSchema = z.object({
  type: z.enum(['open_scene', 'open_modal', 'start_dialog', 'none']),
  payload: z.string().optional(),
  farmLevelMin: z.number().int().min(1).optional(),
  petLevelMin: z.number().int().min(1).optional(),
  requirements: z.object({
    items: z.array(z.object({
      itemType: z.string().min(1),
      qty: z.number().int().min(1),
    })).optional(),
    equips: z.array(z.object({
      slot: z.enum(EQUIP_SLOTS),
      itemType: z.string().min(1).optional(),
    })).optional(),
  }).optional(),
});

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
  interactAction: interactActionSchema.optional(),
  autoConnect: z.boolean().optional(),
  centerOverflow: z.boolean().optional(),
  directionalImages: directionalImagesSchema,
  buyable: z.boolean().optional(),
  gemPrice: z.number().int().min(0).optional(),
  farmLevel: z.number().int().min(0).optional(),
  petLevel: z.number().int().min(0).optional(),
  farmingSkillLevel: z.number().int().min(0).optional(),
  shopSection: z.string().min(1).max(32).optional().nullable(),
  shopCurrency: z.string().min(1).max(48).optional().nullable(),
  isCurrency: z.boolean().optional(),
  sellable: z.boolean().optional(),
  sellPrice: z.number().int().min(0).optional().nullable(),
  availableUntil: z.string().datetime().optional().nullable(),
  gemsGiven: z.number().int().min(0).optional(),
  bugSizeMin: z.number().min(0.1).optional(),
  bugSizeMax: z.number().min(0.1).optional(),
  bugRarity: bugRarityEnum.optional().default('common'),
  bugActiveTime: bugActiveTimeEnum.optional().default('all_day'),
  bugSpawnOn: z.array(z.string().min(1).max(32)).optional(),
  bugWeather: z.enum(['rain']).optional().nullable(),
  bugScenes: z.array(z.string().min(1).max(64)).optional(),
  bugCollectionTags: z.array(z.string().min(1).max(32)).optional(),
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
  foodHunger: z.number().min(0).max(100).optional(),
  foodHappiness: z.number().min(0).max(100).optional(),
  foodPetXp: z.number().min(0).optional(),
  foodBuffType: z.string().min(1).max(32).optional(),
  foodBuffDurationMs: z.number().min(0).optional(),
  treeFruit: z.string().min(1).max(48).optional(),
  growsOnTrees: z.array(z.string().min(1).max(32)).optional(),
  equipOverlay: z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    flipX: z.boolean().optional(),
    flipY: z.boolean().optional(),
    rotationDeg: z.number().optional(),
    scale: z.number().min(0.05).max(8).optional(),
  }).optional().nullable(),
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
  interactAction: interactActionSchema.optional().nullable(),
  autoConnect: z.boolean().optional(),
  centerOverflow: z.boolean().optional(),
  directionalImages: directionalImagesSchema.nullable(),
  buyable: z.boolean().optional(),
  gemPrice: z.number().int().min(0).optional(),
  farmLevel: z.number().int().min(0).optional().nullable(),
  petLevel: z.number().int().min(0).optional().nullable(),
  farmingSkillLevel: z.number().int().min(0).optional().nullable(),
  shopSection: z.string().min(1).max(32).optional().nullable(),
  shopCurrency: z.string().min(1).max(48).optional().nullable(),
  isCurrency: z.boolean().optional(),
  sellable: z.boolean().optional(),
  sellPrice: z.number().int().min(0).optional().nullable(),
  availableUntil: z.string().datetime().optional().nullable(),
  gemsGiven: z.number().int().min(0).optional().nullable(),
  bugSizeMin: z.number().min(0.1).optional().nullable(),
  bugSizeMax: z.number().min(0.1).optional().nullable(),
  bugRarity: bugRarityEnum.optional().nullable(),
  bugActiveTime: bugActiveTimeEnum.optional().nullable(),
  bugSpawnOn: z.array(z.string().min(1).max(32)).optional().nullable(),
  bugWeather: z.enum(['rain']).optional().nullable(),
  bugScenes: z.array(z.string().min(1).max(64)).optional().nullable(),
  bugCollectionTags: z.array(z.string().min(1).max(32)).optional().nullable(),
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
  foodHunger: z.number().min(0).max(100).optional().nullable(),
  foodHappiness: z.number().min(0).max(100).optional().nullable(),
  foodPetXp: z.number().min(0).optional().nullable(),
  foodBuffType: z.string().min(1).max(32).optional().nullable(),
  foodBuffDurationMs: z.number().min(0).optional().nullable(),
  treeFruit: z.string().min(1).max(48).optional().nullable(),
  growsOnTrees: z.array(z.string().min(1).max(32)).optional().nullable(),
  equipOverlay: z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    flipX: z.boolean().optional(),
    flipY: z.boolean().optional(),
    rotationDeg: z.number().optional(),
    scale: z.number().min(0.05).max(8).optional(),
  }).optional().nullable(),
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

    if (item.subCategory === 'fruit' && req.body.growsOnTrees?.length) {
      await ensureCompoundTreeDefs(item.itemType, req.body.growsOnTrees);
    }

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
    const body = { ...req.body } as Record<string, unknown>;

    if (typeof body.availableUntil === 'string') {
      body.availableUntil = new Date(body.availableUntil);
    }

    // A `null` from the client means "clear this field". Mongoose drops
    // `undefined` values out of `$set`, so clearing has to go through `$unset`.
    const $set: Record<string, unknown> = {};
    const $unset: Record<string, ''> = {};
    for (const [key, value] of Object.entries(body)) {
      if (value === null) $unset[key] = '';
      else $set[key] = value;
    }

    const item = await GameItemDef.findOneAndUpdate(
      { itemType },
      {
        ...(Object.keys($set).length ? { $set } : {}),
        ...(Object.keys($unset).length ? { $unset } : {}),
      },
      { new: true, runValidators: true },
    );
    if (!item) throw new AppError(`Item type "${itemType}" not found`, 404, 'ITEM_NOT_FOUND');

    if (item.subCategory === 'fruit' && item.growsOnTrees?.length) {
      await ensureCompoundTreeDefs(item.itemType, item.growsOnTrees);
    }

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

// ─── GET /admin/extract-image-colors — Extract dominant colors from an item's image ─

const extractColorsQuerySchema = z.object({
  itemType: z.string().min(1),
});

router.get(
  '/extract-image-colors',
  ...adminGuard,
  validate({ query: extractColorsQuerySchema }),
  catchAsync(async (req, res) => {
    const { itemType } = req.query as { itemType: string };
    const item = await GameItemDef.findOne({ itemType }).lean();
    if (!item?.imageUrl) {
      throw new AppError(`Item "${itemType}" has no image`, 400, 'NO_IMAGE');
    }
    const imageRes = await fetch(item.imageUrl);
    if (!imageRes.ok) {
      throw new AppError('Failed to fetch image', 502, 'FETCH_IMAGE_FAILED');
    }
    const arrayBuffer = await imageRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = imageRes.headers.get('content-type') || 'image/png';
    const colors = await getImageColors(buffer, contentType);
    const hexColors = colors.map((c: { hex: () => string }) => c.hex());
    log.info({ admin: req.user?.id, itemType, count: hexColors.length }, 'Extracted image colors');
    success(res, { colors: hexColors });
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

    const bodyEntries = (req.body as { entries: z.infer<typeof balloonLootEntrySchema>[] }).entries;
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

    const bodyEntries = (req.body as { entries: z.infer<typeof fossilLootEntrySchema>[] }).entries;
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

/**
 * Tiled flooring / strip prompts — keep in sync with
 * hatchly-admin-web-2026/src/lib/imagePrompt.ts.
 */
const STYLE_FRAGMENT_FLOORING_FILL =
  `This is a repeating GAME GROUND TEXTURE, not a prop or object sprite. ` +
  `Art style: cozy stylized 2D farming-game floor (Stardew Valley / Harvest Moon feel), ` +
  `flat hand-painted color with soft medium-scale surface variation — no thick black outlines, no cel-shade rim light. ` +
  `Perspective: strict orthographic top-down only — no angle, no isometric, no foreshortening. ` +
  `Lighting: perfectly flat, even, diffused overhead light — no directional light, no cast shadows, ` +
  `no soft vignette, no corner darkening, no specular hotspot. ` +
  `Canvas: square 1:1, 100% opaque paint edge-to-edge — zero transparent pixels, no margins, no padding, no empty border. ` +
  `CRITICAL — SEAMLESS WRAP: the left edge must continue perfectly into the right edge, and the top into the bottom, ` +
  `so a 3×3 grid of identical copies reads as one continuous floor with no seam, grid line, frame, or tile outline. ` +
  `Pattern rules: evenly distributed detail only; no unique centerpiece, logo, path that starts/ends mid-tile, ` +
  `furniture, characters, or strong one-way gradient. Avoid photo-realism, 3D bevels, text, and watermarks.`;

const STYLE_FRAGMENT_FLOORING_BORDER =
  `This is a ROTATABLE FLOOR EDGE BORDER TILE for a top-down farming game — not a full fill texture and not a prop sprite. ` +
  `Art style: cozy stylized 2D farming-game floor trim (Stardew Valley / Harvest Moon feel), ` +
  `flat hand-painted color matching a seamless fill floor of the same material — no thick black outlines. ` +
  `Perspective: strict orthographic top-down only — no angle, no isometric, no foreshortening. ` +
  `Lighting: perfectly flat, even, diffused overhead light — no directional light, no cast shadows, no vignette. ` +
  `TRANSPARENCY (critical): Transparent PNG. Paint ONLY the decorative border / rim strip. ` +
  `Everything else in the square — including the ground/fill area above the rim — must be fully transparent pixels. ` +
  `Do NOT fill the tile with dirt, grass, stone, or any background ground; the fill will come from a separate seamless tile underneath. ` +
  `LAYOUT (critical): ` +
  `The OUTER decorative border / rim / trim runs ONLY along the BOTTOM edge of the image (canonical south edge), ` +
  `as a horizontal strip that reaches the left and right canvas edges. ` +
  `LEFT and RIGHT ends of that strip must wrap seamlessly so copies can tile along a straight side with no seam. ` +
  `The design must stay correct when the whole tile is rotated 90°, 180°, or 270° so one asset covers north, east, south, and west edges of a floor patch. ` +
  `Do NOT draw a full four-sided picture frame, corner piece, filled rectangle, or unique centerpiece. ` +
  `No furniture, characters, text, watermarks, photo-realism, or 3D bevels.`;

const STYLE_FRAGMENT_STRIP_H =
  `This is a ONE-AXIS REPEATING STRIP TILE for a top-down farming game (e.g. a river, path, or stream segment) — not a full ground fill and not a prop sprite. ` +
  `Art style: cozy stylized 2D farming-game terrain (Stardew Valley / Harvest Moon feel), ` +
  `flat hand-painted color with soft medium-scale surface variation — no thick black outlines. ` +
  `Perspective: strict orthographic top-down only — no angle, no isometric, no foreshortening. ` +
  `Lighting: perfectly flat, even, diffused overhead light — no directional light, no cast shadows, no vignette. ` +
  `TRANSPARENCY (critical): Transparent PNG. Paint ONLY a horizontal band / corridor of the feature. ` +
  `All pixels above and below that band must be fully transparent so the strip can sit over other ground. ` +
  `Do NOT fill the whole square with opaque ground. ` +
  `LAYOUT (critical): ` +
  `The painted band spans the FULL width — left and right edges of the paint must meet the canvas edges. ` +
  `CRITICAL — HORIZONTAL SEAMLESS WRAP ONLY: the left edge must continue perfectly into the right edge ` +
  `so copies placed side-by-side form one continuous strip of any length with no seam. ` +
  `Do NOT require top↔bottom tiling; the top and bottom of the painted band are free edges (banks / margins), not wrap seams. ` +
  `Evenly distribute detail along the length; no unique centerpiece that would scream when repeated. ` +
  `Flow or grain may read left-to-right, but must still wrap cleanly. ` +
  `No furniture, characters, text, watermarks, photo-realism, or 3D bevels.`;

const STYLE_FRAGMENT_STRIP_V =
  `This is a ONE-AXIS REPEATING STRIP TILE for a top-down farming game (e.g. a north–south river, path, or stream segment) — not a full ground fill and not a prop sprite. ` +
  `Art style: cozy stylized 2D farming-game terrain (Stardew Valley / Harvest Moon feel), ` +
  `flat hand-painted color with soft medium-scale surface variation — no thick black outlines. ` +
  `Perspective: strict orthographic top-down only — no angle, no isometric, no foreshortening. ` +
  `Lighting: perfectly flat, even, diffused overhead light — no directional light, no cast shadows, no vignette. ` +
  `TRANSPARENCY (critical): Transparent PNG. Paint ONLY a vertical band / corridor of the feature. ` +
  `All pixels left and right of that band must be fully transparent so the strip can sit over other ground. ` +
  `Do NOT fill the whole square with opaque ground. ` +
  `LAYOUT (critical): ` +
  `The painted band spans the FULL height — top and bottom edges of the paint must meet the canvas edges. ` +
  `CRITICAL — VERTICAL SEAMLESS WRAP ONLY: the top edge must continue perfectly into the bottom edge ` +
  `so copies stacked north–south form one continuous strip of any length with no seam. ` +
  `Do NOT require left↔right tiling; the left and right of the painted band are free edges (banks / margins), not wrap seams. ` +
  `Evenly distribute detail along the length; no unique centerpiece that would scream when repeated. ` +
  `Flow or grain may read top-to-bottom, but must still wrap cleanly. ` +
  `No furniture, characters, text, watermarks, photo-realism, or 3D bevels.`;

const STYLE_FRAGMENT_STRIP_END =
  `This is an END CAP / TERMINUS TILE for a top-down farming-game strip (river mouth, path end, stream tip) — not a repeating mid-segment and not a full ground fill. ` +
  `Art style: cozy stylized 2D farming-game terrain (Stardew Valley / Harvest Moon feel), ` +
  `flat hand-painted color — no thick black outlines. ` +
  `Perspective: strict orthographic top-down only. Lighting: flat even overhead — no cast shadows, no vignette. ` +
  `TRANSPARENCY (critical): Transparent PNG. Paint ONLY the strip feature and its natural end; ` +
  `surrounding ground must be fully transparent pixels. ` +
  `REFERENCE MATCHING (critical when a reference image is attached): ` +
  `Preserve the reference strip's exact material, palette, band width, edge/bank style, and brush character. ` +
  `Do not restyle, recolor, or change scale. Only invent the finishing terminus. ` +
  `LAYOUT: One end of the painted band should be a clean join face that can butt against a repeating strip tile; ` +
  `the opposite end should be a finished terminus (tip, fade, mouth, or rounded end) — NOT seamless on that side. ` +
  `Square 1:1 canvas. No furniture, characters, text, watermarks, photo-realism, or 3D bevels.`;

const STYLE_FRAGMENT_GROUND_OVERLAY =
  `This is a GROUND DECAL / OVERLAY STAMP for a top-down farming game — not a seamless fill tile and not a boxed prop sprite. ` +
  `Art style: cozy stylized 2D farming-game terrain (Stardew Valley / Harvest Moon feel), ` +
  `flat hand-painted color with soft medium-scale surface variation — no thick black outlines, no cel-shade rim light. ` +
  `Perspective: strict orthographic top-down only — no angle, no isometric, no foreshortening. ` +
  `Lighting: perfectly flat, even, diffused overhead light — no directional light, no drop shadow, no vignette. ` +
  `TRANSPARENCY (critical): Transparent PNG. The painted feature is an IRREGULAR organic patch, pile, carpet, or mist — never a filled rectangle. ` +
  `The canvas must stay mostly transparent. All four corners and a wide outer margin must be fully transparent pixels. ` +
  `SOFT BLEND (critical): Alpha-feather the silhouette. Edges fade gradually from the painted feature into fully transparent pixels ` +
  `so the stamp composites over grass/dirt underneath with no hard square, no white halo, and no opaque ground plane. ` +
  `Do NOT paint dirt, grass, soil, or any background terrain — those come from the floor tile under this overlay. ` +
  `Interior pixels should be partly see-through (especially fog, mist, moss, ash, and scattered leaves) so the ground shows through. ` +
  `Do NOT make a seamless wrap; this is a unique stamp, not a repeating texture. ` +
  `No furniture, characters, text, watermarks, photo-realism, or 3D bevels.`;

type TiledFloorKind = 'floor_fill' | 'floor_border' | 'strip_h' | 'strip_v' | 'strip_end' | 'ground_overlay';

function resolveTiledFloorKind(subCategory?: string | null): TiledFloorKind {
  if (
    subCategory === 'floor_border' ||
    subCategory === 'strip_h' ||
    subCategory === 'strip_v' ||
    subCategory === 'strip_end' ||
    subCategory === 'ground_overlay'
  ) {
    return subCategory;
  }
  return 'floor_fill';
}

function defaultGroundOverlayPrompt(itemName: string): string {
  return `Irregular transparent overlay stamp of ${itemName} that blends into the ground underneath in a cozy top-down farming game. ${STYLE_FRAGMENT_GROUND_OVERLAY}`;
}

function defaultTiledFloorPrompt(itemName: string, kind: TiledFloorKind): string {
  switch (kind) {
    case 'floor_border':
      return `Seamless rotatable edge-border floor tile for ${itemName} in a cozy top-down farming game. ${STYLE_FRAGMENT_FLOORING_BORDER}`;
    case 'strip_h':
      return `Horizontally tileable transparent strip of ${itemName} for a cozy top-down farming game (repeat side-by-side for any length). ${STYLE_FRAGMENT_STRIP_H}`;
    case 'strip_v':
      return `Vertically tileable transparent strip of ${itemName} for a cozy top-down farming game (stack north–south for any length). ${STYLE_FRAGMENT_STRIP_V}`;
    case 'strip_end':
      return `End-cap / terminus piece for ${itemName} that matches an attached repeating-strip reference in a cozy top-down farming game. ${STYLE_FRAGMENT_STRIP_END}`;
    case 'ground_overlay':
      return defaultGroundOverlayPrompt(itemName);
    default:
      return `Seamless tileable floor texture of ${itemName} for a cozy top-down farming game. ${STYLE_FRAGMENT_FLOORING_FILL}`;
  }
}

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
    const isTiledFlooring = item.category === 'tiled_flooring';
    const isOverlay = item.subCategory === 'ground_overlay';
    const tiledKind = isTiledFlooring ? resolveTiledFloorKind(item.subCategory) : null;
    const styleFragment =
      item.category === 'fish' ? STYLE_FRAGMENT_FISH
      : item.subCategory === 'chairs' ? STYLE_FRAGMENT_CHAIRS
      : STYLE_FRAGMENT;
    let prompt = typeof req.body.prompt === 'string' && req.body.prompt.trim()
      ? req.body.prompt
      : isOverlay
        ? defaultGroundOverlayPrompt(itemName)
        : isTiledFlooring && tiledKind
          ? defaultTiledFloorPrompt(itemName, tiledKind)
          : `A single ${itemName}, 2D game sprite for a cozy top-down farming game. ${styleFragment}`;

    const referenceItemType = req.body.referenceItemType as string | undefined;
    if (referenceItemType) {
      // OpenAI edit best practice: name the input and state preserve vs change.
      prompt =
        `${prompt} Image 1 is the style/material reference. Keep Image 1's identity: ` +
        `same colors, materials, band width, edge character, and lighting. ` +
        `Change only what the prompt asks for. Do not invent a new art style.`;
    }

    // Fill tiles are opaque (seams show if edges are transparent).
    // Borders / strips / end caps / ground overlays stay transparent so they layer over ground.
    const opaqueFloor = isTiledFlooring && tiledKind === 'floor_fill' && !isOverlay;
    const imageOpts = {
      size: '1024x1024' as const,
      quality: (isTiledFlooring ? 'high' : 'medium') as 'high' | 'medium',
      background: (opaqueFloor ? 'opaque' : 'transparent') as 'opaque' | 'transparent',
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
      log.info({ admin: req.user?.id, itemType, referenceItemType, tiledKind }, 'Generating game item image with reference');
      base64DataUri = await openAIService.editImageBase64(refBase64, prompt, {
        ...imageOpts,
        inputFidelity: 'high',
      });
    } else {
      log.info({ admin: req.user?.id, itemType, prompt, tiledKind }, 'Generating game item image');
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
// Shop Admin CRUD
// ═════════════════════════════════════════════════════════════════════════════

const shopKeySchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9_]+$/, 'Lowercase alphanumeric + underscores');

const shopBodySchema = z.object({
  key: shopKeySchema,
  label: z.string().min(1).max(48),
  sortOrder: z.number().int().optional(),
});

const shopUpdateSchema = z.object({
  label: z.string().min(1).max(48).optional(),
  sortOrder: z.number().int().optional(),
});

const MAIN_SHOP = { key: '', label: 'Main shop', builtin: true as const, sortOrder: -1 };

/**
 * GET /admin/shops — List shops (main is always first; seeds fishing_shop if missing)
 */
router.get(
  '/shops',
  ...adminGuard,
  catchAsync(async (_req, res) => {
    await Shop.updateOne(
      { key: 'fishing_shop' },
      { $setOnInsert: { key: 'fishing_shop', label: 'Fishing shop', sortOrder: 0 } },
      { upsert: true },
    );
    const shops = await Shop.find().sort({ sortOrder: 1, label: 1 }).lean();
    success(
      res,
      [
        MAIN_SHOP,
        ...shops.map((s) => ({
          key: s.key,
          label: s.label,
          sortOrder: s.sortOrder ?? 0,
          builtin: s.key === 'fishing_shop',
          id: s._id?.toString(),
        })),
      ],
    );
  }),
);

/**
 * POST /admin/shops — Create a shop section
 */
router.post(
  '/shops',
  ...adminGuard,
  validate({ body: shopBodySchema }),
  catchAsync(async (req, res) => {
    const { key, label, sortOrder } = req.body;
    const existing = await Shop.findOne({ key });
    if (existing) throw new AppError(`Shop "${key}" already exists`, 409, 'DUPLICATE_SHOP');

    const shop = await Shop.create({ key, label, sortOrder: sortOrder ?? 0 });
    log.info({ admin: req.user?.id, key: shop.key }, 'Shop created');
    success(
      res,
      {
        key: shop.key,
        label: shop.label,
        sortOrder: shop.sortOrder,
        builtin: false,
        id: shop.id,
      },
      201,
    );
  }),
);

/**
 * PATCH /admin/shops/:key — Update shop label / sort order
 */
router.patch(
  '/shops/:key',
  ...adminGuard,
  validate({ body: shopUpdateSchema }),
  catchAsync(async (req, res) => {
    const key = req.params.key;
    if (!key) throw new AppError('Main shop cannot be updated', 400, 'BUILTIN_SHOP');

    const shop = await Shop.findOneAndUpdate(
      { key },
      { $set: req.body },
      { new: true, runValidators: true },
    );
    if (!shop) throw new AppError('Shop not found', 404, 'SHOP_NOT_FOUND');
    log.info({ admin: req.user?.id, key: shop.key }, 'Shop updated');
    success(res, {
      key: shop.key,
      label: shop.label,
      sortOrder: shop.sortOrder,
      builtin: shop.key === 'fishing_shop',
      id: shop.id,
    });
  }),
);

/**
 * DELETE /admin/shops/:key — Delete shop row (no cascade to banners/items)
 */
router.delete(
  '/shops/:key',
  ...adminGuard,
  catchAsync(async (req, res) => {
    const key = req.params.key;
    if (!key || key === 'fishing_shop') {
      throw new AppError('Builtin shops cannot be deleted', 400, 'BUILTIN_SHOP');
    }
    const shop = await Shop.findOneAndDelete({ key });
    if (!shop) throw new AppError('Shop not found', 404, 'SHOP_NOT_FOUND');
    log.info({ admin: req.user?.id, key }, 'Shop deleted');
    success(res, { deleted: true, key });
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
// Image proxy (admin editor pixel reads — knockout / hit-test)
// ═════════════════════════════════════════════════════════════════════════════

const ALLOWED_IMAGE_HOSTS = new Set(['images.hatchly.me']);

router.get(
  '/image-proxy',
  ...adminGuard,
  catchAsync(async (req, res) => {
    const raw = String(req.query.url ?? '');
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new AppError('Invalid image URL', 400, 'INVALID_IMAGE_URL');
    }
    if (parsed.protocol !== 'https:' || !ALLOWED_IMAGE_HOSTS.has(parsed.hostname)) {
      throw new AppError('Image host not allowed', 400, 'INVALID_IMAGE_HOST');
    }
    const upstream = await fetch(parsed.href);
    if (!upstream.ok) {
      throw new AppError(`Could not fetch image (${upstream.status})`, 502, 'IMAGE_PROXY_FAILED');
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(buf);
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
  scale: z.number().min(0.1).max(20).default(1),
  scaleX: z.number().min(0.1).max(20).optional(),
  scaleY: z.number().min(0.1).max(20).optional(),
  depthOffset: z.number().optional(),
  rotationDegrees: z.number().min(0).max(360).optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
  /** Bake-time hue rotation in degrees (0 = unchanged). */
  hueDegrees: z.number().min(0).max(360).optional(),
  /** Bake-time saturation multiplier (1 = unchanged). */
  saturation: z.number().min(0).max(3).optional(),
  /** Bake-time brightness multiplier (1 = unchanged). */
  brightness: z.number().min(0).max(3).optional(),
  /** Bake-time contrast multiplier (1 = unchanged). */
  contrast: z.number().min(0).max(3).optional(),
  /** Bake-time shadow lift 0–100 (0 = unchanged). Softens dark outlines. */
  shadowLift: z.number().min(0).max(100).optional(),
  /** Bake-time highlight pull-down 0–100 (0 = unchanged). Softens hot whites. */
  highlightCompress: z.number().min(0).max(100).optional(),
  /** Bake-time warm↔cool −100…100 (0 = unchanged). */
  warmth: z.number().min(-100).max(100).optional(),
  /** Bake-time opacity 0–1 (1 = opaque). */
  opacity: z.number().min(0).max(1).optional(),
  /** Edge fade 0–100 (% of that side of the sprite). */
  featherTop: z.number().min(0).max(100).optional(),
  featherRight: z.number().min(0).max(100).optional(),
  featherBottom: z.number().min(0).max(100).optional(),
  featherLeft: z.number().min(0).max(100).optional(),
  /** Punch this hex colour out of the sprite. */
  knockoutColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  knockoutTolerance: z.number().min(0).max(100).optional(),
  /** Bake-time composite blend mode. */
  blendMode: z
    .enum(['over', 'multiply', 'screen', 'overlay', 'soft-light', 'darken', 'lighten'])
    .optional(),
  /** Omit from bake; client renders as a depth-sorted sprite. */
  live: z.boolean().optional(),
});

const sceneColourGradeSchema = z
  .object({
    hueDegrees: z.number().min(0).max(360).optional(),
    saturation: z.number().min(0).max(3).optional(),
    brightness: z.number().min(0).max(3).optional(),
    contrast: z.number().min(0).max(3).optional(),
    shadowLift: z.number().min(0).max(100).optional(),
    highlightCompress: z.number().min(0).max(100).optional(),
    warmth: z.number().min(-100).max(100).optional(),
    opacity: z.number().min(0).max(1).optional(),
    blendMode: z
      .enum(['over', 'multiply', 'screen', 'overlay', 'soft-light', 'darken', 'lighten'])
      .optional(),
  })
  .optional()
  .nullable();

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

const miningTileSchema = z.object({
  col: z.number().int().min(0),
  row: z.number().int().min(0),
  oreType: z.string().min(1).max(40).default('copper'),
});
const miningTilesSchema = z.array(miningTileSchema).optional();

const sceneCreateSchema = z.object({
  name: z.string().min(1).max(64),
  slug: z.string().min(1).max(48).regex(/^[a-z0-9_]+$/, 'Lowercase alphanumeric + underscores'),
  cols: z.number().int().min(8).max(128),
  rows: z.number().int().min(8).max(128),
  bgColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#7EC87E'),
  tiledFlooringItemType: z.string().min(1).max(64).optional().nullable(),
  tiledFlooringStyle: sceneColourGradeSchema,
  grassNoiseStrength: z.number().min(0).max(0.2).default(0.04),
  farmCols: z.number().int().min(4).max(64),
  farmRows: z.number().int().min(4).max(64),
  walkableRect: walkableRectSchema,
  unwalkableTiles: unwalkableTilesSchema,
  fishingTiles: fishingTilesSchema,
  miningTiles: miningTilesSchema,
  spawnX: z.number().optional(),
  spawnY: z.number().optional(),
});

const sceneUpdateSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  cols: z.number().int().min(8).max(128).optional(),
  rows: z.number().int().min(8).max(128).optional(),
  bgColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  tiledFlooringItemType: z.string().min(1).max(64).optional().nullable(),
  tiledFlooringStyle: sceneColourGradeSchema,
  grassNoiseStrength: z.number().min(0).max(0.2).optional(),
  farmCols: z.number().int().min(4).max(64).optional(),
  farmRows: z.number().int().min(4).max(64).optional(),
  placements: z.array(scenePlacementSchema).optional(),
  walkableRect: walkableRectSchema,
  unwalkableTiles: unwalkableTilesSchema,
  fishingTiles: fishingTilesSchema,
  miningTiles: miningTilesSchema,
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
      ('tiledFlooringItemType' in req.body &&
        req.body.tiledFlooringItemType !== (current as { tiledFlooringItemType?: string }).tiledFlooringItemType) ||
      ('tiledFlooringStyle' in req.body &&
        JSON.stringify(req.body.tiledFlooringStyle ?? null) !==
          JSON.stringify((current as { tiledFlooringStyle?: unknown }).tiledFlooringStyle ?? null));
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

// ─── Admin: Quest vocabulary ──────────────────────────────────────────────────

/** The picklists the quest editors render, straight from the runtime's vocabulary. */
router.get(
  '/quest-vocabulary',
  ...adminGuard,
  catchAsync(async (_req, res) => {
    const payloads = await GameItemDef.distinct('interactAction.payload', {
      'interactAction.payload': { $exists: true, $ne: '' },
    });
    success(res, {
      actions: [...QUEST_ACTIONS],
      actionLabels: ACTION_LABELS,
      equipSlots: [...EQUIP_SLOTS],
      triggerTypes: [...QUEST_TRIGGER_TYPES],
      questTypes: [...QUEST_TYPES],
      highlightTypes: [...DIALOG_HIGHLIGHT_TYPES],
      hudButtonTargets: [...HUD_BUTTON_TARGETS],
      modalPayloads: payloads.sort(),
      farmLevels: FARM_LEVELS,
    });
  }),
);

// ─── Admin: Quests ──────────────────────────────────────────────────────────

const questRequirementSchema = z.object({
  items: z.array(z.object({ itemType: z.string().min(1), qty: z.number().int().min(1) })).optional(),
  buildings: z.array(z.object({ itemType: z.string().min(1), count: z.number().int().min(1) })).optional(),
  actions: z.array(z.object({ action: z.string().min(1), count: z.number().int().min(1), itemType: z.string().min(1).optional() })).optional(),
  equips: z.array(z.object({ slot: z.enum(EQUIP_SLOTS), itemType: z.string().min(1).optional() })).optional(),
  talk_to_npc: z.array(z.object({ npcItemType: z.string().min(1), count: z.number().int().min(1).optional() })).optional(),
  crop_grown: z.array(z.object({ itemType: z.string().min(1), count: z.number().int().min(1).optional() })).optional(),
  open_modal: z.array(z.object({ payload: z.string().min(1), count: z.number().int().min(1).optional() })).optional(),
  farmXp: z.number().int().min(1).optional(),
});

const questRewardSchema = z.object({
  items: z.array(z.object({ itemType: z.string().min(1), qty: z.number().int().min(1) })).optional(),
  gems: z.number().int().min(0).optional(),
  xp: z.number().int().min(0).optional(),
  recipes: z.array(z.string().min(1)).optional(),
});

const dialogHighlightSchema = z.object({
  type: z.enum(DIALOG_HIGHLIGHT_TYPES),
  target: z.string().min(1),
});

const dialogStepSchema = z.object({
  text: z.string().min(1).max(500),
  highlight: dialogHighlightSchema.optional(),
  blocking: z.boolean().optional(),
  speaker: z.enum(['pet', 'npc']).optional(),
});

const questTriggerSchema = z.object({
  type: z.enum(QUEST_TRIGGER_TYPES),
  questId: z.string().max(64).optional(),
  npcItemType: z.string().max(64).optional(),
  sceneSlug: z.string().max(64).optional(),
  firstVisitOnly: z.boolean().optional(),
});

const createQuestSchema = z.object({
  questId: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
  type: z.enum(QUEST_TYPES),
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
  progressDialog: z.array(dialogStepSchema).optional(),
  startDialogSpeaker: z.enum(['pet', 'npc']).optional(),
  endDialogSpeaker: z.enum(['pet', 'npc']).optional(),
  progressDialogSpeaker: z.enum(['pet', 'npc']).optional(),
  triggers: z.array(questTriggerSchema).optional(),
});

const updateQuestSchema = z.object({
  type: z.enum(QUEST_TYPES).optional(),
  title: z.string().min(1).max(128).optional(),
  description: z.string().max(512).optional(),
  farmLevel: z.number().int().min(2).max(20).optional().nullable(),
  petLevelMin: z.number().int().min(1).optional().nullable(),
  farmLevelMin: z.number().int().min(1).optional().nullable(),
  requiredQuestId: z.string().max(64).optional().nullable(),
  requirements: questRequirementSchema.optional(),
  rewards: questRewardSchema.optional(),
  sortOrder: z.number().int().optional(),
  startDialog: z.array(dialogStepSchema).optional().nullable(),
  endDialog: z.array(dialogStepSchema).optional().nullable(),
  progressDialog: z.array(dialogStepSchema).optional().nullable(),
  startDialogSpeaker: z.enum(['pet', 'npc']).optional().nullable(),
  endDialogSpeaker: z.enum(['pet', 'npc']).optional().nullable(),
  progressDialogSpeaker: z.enum(['pet', 'npc']).optional().nullable(),
  triggers: z.array(questTriggerSchema).optional().nullable(),
});

/**
 * Rejects a save whose quest points at things that don't exist. Warnings are
 * returned to the caller rather than blocking, so an author can still save a
 * work in progress.
 */
async function assertAuthorable(draft: QuestDraft): Promise<QuestProblem[]> {
  const problems = await validateQuest(draft);
  const errors = problems.filter((p) => p.severity === 'error');
  if (errors.length > 0) {
    const err = new AppError('This quest can\'t work as authored', 400, 'QUEST_INVALID');
    err.details = errors.map((e) => ({ field: e.field, message: e.message }));
    throw err;
  }
  return problems;
}

router.get(
  '/quests',
  ...adminGuard,
  catchAsync(async (_req, res) => {
    const quests = await QuestDef.find().sort({ sortOrder: 1, questId: 1 }).lean();
    success(res, { quests });
  }),
);

/** Health check across every authored quest. */
router.get(
  '/quests/lint',
  ...adminGuard,
  catchAsync(async (_req, res) => {
    success(res, { problems: await lintAllQuests() });
  }),
);

router.post(
  '/quests',
  ...adminGuard,
  validate({ body: createQuestSchema }),
  catchAsync(async (req, res) => {
    const existing = await QuestDef.findOne({ questId: req.body.questId }).lean();
    if (existing) throw new AppError('Quest ID already exists', 409, 'QUEST_EXISTS');
    const warnings = await assertAuthorable(req.body);
    const quest = await QuestDef.create(req.body);
    log.info({ admin: req.user?.id, questId: quest.questId }, 'Quest created');
    success(res, { ...quest.toObject(), warnings }, 201);
  }),
);

router.patch(
  '/quests/:questId',
  ...adminGuard,
  validate({ body: updateQuestSchema }),
  catchAsync(async (req, res) => {
    const current = await QuestDef.findOne({ questId: req.params.questId }).lean();
    if (!current) throw new AppError('Quest not found', 404, 'QUEST_NOT_FOUND');

    // Validate the result of the edit, not just the fields that changed.
    const warnings = await assertAuthorable({ ...current, ...req.body } as QuestDraft);

    const set: Record<string, unknown> = {};
    const unset: Record<string, ''> = {};
    for (const [key, value] of Object.entries(req.body)) {
      if (value === null) unset[key] = '';
      else set[key] = value;
    }

    const quest = await QuestDef.findOneAndUpdate(
      { questId: req.params.questId },
      { ...(Object.keys(set).length && { $set: set }), ...(Object.keys(unset).length && { $unset: unset }) },
      { new: true },
    );
    if (!quest) throw new AppError('Quest not found', 404, 'QUEST_NOT_FOUND');
    log.info({ admin: req.user?.id, questId: quest.questId }, 'Quest updated');
    success(res, { ...quest.toObject(), warnings });
  }),
);

router.delete(
  '/quests/:questId',
  ...adminGuard,
  catchAsync(async (req, res) => {
    const result = await QuestDef.deleteOne({ questId: req.params.questId });
    if (result.deletedCount === 0) throw new AppError('Quest not found', 404, 'QUEST_NOT_FOUND');
    await UserQuest.deleteMany({ questId: req.params.questId });
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

/** POST /admin/my-farm/reset-quests - Replay the quest flow from the beginning. */
const resetQuestsSchema = z.object({
  /**
   * Leaves the farm at its current size. Dropping back to level 1 shrinks the
   * grid, which strands anything already built outside the new fence line — so
   * a developer replaying a questline on a built-up farm wants this on.
   */
  keepFarmLevel: z.boolean().optional(),
});
router.post(
  '/my-farm/reset-quests',
  ...adminGuard,
  validate({ body: resetQuestsSchema }),
  catchAsync(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    const { keepFarmLevel } = (req as any).body as z.infer<typeof resetQuestsSchema>;
    const deleted = await questService.resetForUser(userId);

    const farm = await farmService.loadOrCreateFarm(userId);
    const farmLevel = keepFarmLevel ? farm.farmLevel : 1;
    if (!keepFarmLevel) {
      // Quest-driven levels mean a full reset has to reset the level too, or the
      // upgrade quests would have nothing left to unlock.
      farm.farmLevel = 1;
      await farm.save();
    }

    log.info({ admin: userId, deleted, keepFarmLevel: !!keepFarmLevel }, 'Admin reset own quests');
    success(res, { deleted, farmLevel });
  }),
);

/** POST /admin/my-farm/reset-farm — Full game wipe (farm, quests, skills, collections). Health logs stay. */
router.post(
  '/my-farm/reset-farm',
  ...adminGuard,
  catchAsync(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    const result = await resetGameAccount(userId);
    log.info({ admin: userId, ...result }, 'Admin reset own game account');
    success(res, { ok: true, ...result });
  }),
);

/** POST /admin/my-farm/reset-spirit-snatch — Clear Spirit Snatch hourly cooldown. */
router.post(
  '/my-farm/reset-spirit-snatch',
  ...adminGuard,
  catchAsync(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    await resetSpiritSnatchCooldown(userId);
    log.info({ admin: userId }, 'Admin reset Spirit Snatch cooldown');
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

    const farm = await farmService.loadOrCreateFarm(userId);

    if (typeof gems === 'number') farm.gems = gems;

    // Setting the level is now a single assignment. It used to require faking XP
    // and upserting completed upgrade quests to fool the level derivation.
    if (typeof farmLevel === 'number' && FARM_LEVELS.some((l) => l.level === farmLevel)) {
      farm.farmLevel = farmLevel;
    }

    await farm.save();
    log.info({ admin: userId, gems: farm.gems, farmLevel: farm.farmLevel }, 'Admin updated own farm');
    success(res, {
      farmXp: farm.xp,
      gems: farm.gems,
      farmLevel: farm.farmLevel,
    });
  }),
);

/** POST /admin/my-farm/grant-item - Add item to current user's inventory (admin testing). */
const grantItemSchema = z.object({
  itemType: z.string().min(1).max(64),
  qty: z.number().int().min(1).max(99).optional(),
});
router.post(
  '/my-farm/grant-item',
  ...adminGuard,
  validate({ body: grantItemSchema }),
  catchAsync(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    const { itemType, qty = 1 } = (req as any).body;

    const def = await GameItemDef.findOne({ itemType }).lean();
    if (!def) throw new AppError(`Unknown item type: ${itemType}`, 400, 'UNKNOWN_ITEM');

    const farm = await farmService.loadOrCreateFarm(userId);
    const { addToBackpack } = await import('../services/inventoryCapacity.js');
    addToBackpack(farm, itemType, qty);
    await farm.save();

    const inv: Record<string, number> = {};
    for (const [k, v] of farm.inventory) if (v > 0) inv[k] = v;
    log.info({ admin: userId, itemType, qty }, 'Admin granted item to own inventory');
    success(res, { inventory: inv });
  }),
);

/**
 * POST /admin/my-farm/place-item — Put an item straight onto the current user's
 * farm. Grants a copy first so the normal placement path (bounds, soil and tree
 * rules) does the validating. Omit col/row to drop it in the first free spot,
 * which is how content seeding places NPCs without knowing the map.
 */
const placeItemSchema = z.object({
  itemType: z.string().min(1).max(64),
  col: z.number().int().min(0).optional(),
  row: z.number().int().min(0).optional(),
});
router.post(
  '/my-farm/place-item',
  ...adminGuard,
  validate({ body: placeItemSchema }),
  catchAsync(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    const { itemType, col, row } = (req as any).body as z.infer<typeof placeItemSchema>;

    const def = await GameItemDef.findOne({ itemType }).lean();
    if (!def) throw new AppError(`Unknown item type: ${itemType}`, 400, 'UNKNOWN_ITEM');

    const farm = await farmService.loadOrCreateFarm(userId);
    const { gridCols, gridRows } = await farmService.getGridDimensions(userId);

    let target: { col: number; row: number } | null =
      col != null && row != null ? { col, row } : null;

    if (!target) {
      const occupied = new Set(farm.placedItems.map((i) => `${i.col},${i.row}`));
      const free = (c: number, r: number) => {
        for (let dr = 0; dr < def.rows; dr++) {
          for (let dc = 0; dc < def.cols; dc++) {
            if (occupied.has(`${c + dc},${r + dr}`)) return false;
          }
        }
        return true;
      };
      // Search from the middle rows outward: the top row is the house and the
      // bottom edge tends to be where players build.
      const startRow = Math.floor(gridRows / 3);
      for (let r = startRow; r <= gridRows - def.rows && !target; r++) {
        for (let c = 0; c <= gridCols - def.cols && !target; c++) {
          if (free(c, r)) target = { col: c, row: r };
        }
      }
      if (!target) throw new AppError('No free space on the farm', 409, 'FARM_FULL');
    }

    const current = farm.inventory.get(itemType) ?? 0;
    farm.inventory.set(itemType, current + 1);
    farm.markModified('inventory');
    await farm.save();

    try {
      await farmService.placeItem(userId, itemType, target.col, target.row);
    } catch (err: any) {
      throw new AppError(err.message ?? 'Placement failed', 400, 'PLACEMENT_FAILED');
    }

    log.info({ admin: userId, itemType, ...target }, 'Admin placed item on own farm');
    success(res, { itemType, col: target.col, row: target.row });
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
  recipeType: z.enum(['cooking', 'crafting', 'smelting']).optional(),
  recipeItemType: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/).optional(),
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

    const body = { ...req.body };
    if ((body.recipeType ?? 'cooking') === 'crafting') {
      const { ensureCraftingRecipeItemDef, defaultRecipeItemType } = await import(
        '../services/CraftingRecipeItems.js'
      );
      body.recipeItemType = body.recipeItemType || defaultRecipeItemType(body.recipeId);
      await ensureCraftingRecipeItemDef({
        recipeId: body.recipeId,
        label: body.label,
        recipeItemType: body.recipeItemType,
      });
      await broadcastItemDefs();
    }

    const recipe = await Recipe.create(body);
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

    if (recipe.recipeType === 'crafting') {
      const { ensureCraftingRecipeItemDef, defaultRecipeItemType } = await import(
        '../services/CraftingRecipeItems.js'
      );
      recipe.recipeItemType = recipe.recipeItemType || defaultRecipeItemType(recipe.recipeId);
      await ensureCraftingRecipeItemDef({
        recipeId: recipe.recipeId,
        label: recipe.label,
        recipeItemType: recipe.recipeItemType,
      });
      await broadcastItemDefs();
    }

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

// ─── Admin: Multiplayer Stress Test ───────────────────────────────────────

const stressTestSchema = {
  body: z.object({
    count: z.number().int().min(1).max(30).default(10),
  }),
};

router.post(
  '/multiplayer/stress-test',
  ...adminGuard,
  validate(stressTestSchema),
  catchAsync(async (req, res) => {
    const adminId = req.user?._id?.toString();
    if (!adminId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');
    const count = (req.body as { count?: number }).count ?? 10;
    const result = await spawnStressTestBots(adminId, count);
    if (result.error) {
      throw new AppError(result.error, 400, 'STRESS_TEST_FAILED');
    }
    success(res, { spawned: result.spawned });
  }),
);

router.post(
  '/multiplayer/stress-test/remove',
  ...adminGuard,
  catchAsync(async (req, res) => {
    const adminId = req.user?._id?.toString();
    if (!adminId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');
    const result = await removeStressTestBots(adminId);
    success(res, { removed: result.removed });
  }),
);

export default router;
