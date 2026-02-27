import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { farmService, FARM_LEVELS } from '../services/FarmService.js';
import { questService } from '../services/QuestService.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { ShopBanner } from '../models/ShopBanner.js';
import { UserCollection } from '../models/UserCollection.js';
import { Scene } from '../models/Scene.js';
import { cookingService } from '../services/CookingService.js';
import { craftingService } from '../services/CraftingService.js';

const router = Router();

/**
 * GET /game/summary
 *
 * Lightweight summary for home tab: farm level, gems, active quest count.
 */
router.get(
  '/summary',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return success(res, { farmLevel: 1, gems: 0, questCount: 0, farmLevelTitle: 'Seedling', farmLevelEmoji: '🌱', xpProgress: 0 });

    const farm = await farmService.loadOrCreateFarm(userId);
    const level = await farmService.resolveFarmLevel(userId, farm.xp);
    const quests = await questService.getQuestsForUser(userId);
    const activeQuests = quests.filter((q) => q.status === 'active');
    const nextLevel = FARM_LEVELS.find((l) => l.level === level.level + 1);
    const xpInLevel = farm.xp - level.xpRequired;
    const xpNeeded = nextLevel ? nextLevel.xpRequired - level.xpRequired : 0;
    const xpProgress = xpNeeded > 0 ? Math.min(100, Math.round((xpInLevel / xpNeeded) * 100)) : 100;

    success(res, {
      farmLevel: level.level,
      gems: farm.gems,
      questCount: activeQuests.length,
      farmLevelTitle: level.title,
      farmLevelEmoji: level.emoji,
      xpProgress,
    });
  }),
);

/**
 * GET /game/items
 *
 * Returns all item definitions sorted by sortOrder.
 * Fetched once by the client on game load.
 */
router.get(
  '/items',
  protect,
  catchAsync(async (_req, res) => {
    const items = await GameItemDef.find().sort({ sortOrder: 1 }).lean();
    success(res, items);
  }),
);

/**
 * GET /game/shop-config?section=fishing_shop
 *
 * Returns shop banners (section definitions) for the Shop tab.
 * Used to render the banner strip and section navigation.
 * section= missing/empty → main shop banners (shopSection null/undefined)
 * section=fishing_shop → fishing shop banners only
 */
router.get(
  '/shop-config',
  protect,
  catchAsync(async (req, res) => {
    const section = (req.query.section as string) || '';
    const filter = section
      ? { shopSection: section }
      : { $or: [{ shopSection: { $exists: false } }, { shopSection: null }, { shopSection: '' }] };
    const banners = await ShopBanner.find(filter).sort({ sortOrder: 1 }).lean();
    success(res, { banners });
  }),
);

/**
 * GET /game/collection?category=bug
 *
 * Returns the current user's collection aggregated by itemType.
 * category: bug | fish | discoverables (optional; defaults to bug if omitted).
 */
router.get(
  '/collection',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return success(res, []);

    const category = (req.query.category as string) || 'bug';
    const valid = ['bug', 'fish', 'discoverables'];
    if (!valid.includes(category)) return success(res, []);

    // Backwards compat: 'discoverables' includes legacy 'fossil' category
    const categories = category === 'discoverables' ? ['discoverables', 'fossil'] : [category];
    const docs = await UserCollection.find({ userId, category: { $in: categories } })
      .sort({ caughtAt: -1 })
      .lean();

    const byItemType = new Map<string, { count: number; bestSize: number; lastCaught: string }>();
    for (const d of docs) {
      const existing = byItemType.get(d.itemType);
      const caughtStr = d.caughtAt instanceof Date ? d.caughtAt.toISOString() : String(d.caughtAt);
      if (!existing) {
        byItemType.set(d.itemType, { count: 1, bestSize: d.size, lastCaught: caughtStr });
      } else {
        existing.count += 1;
        existing.bestSize = Math.max(existing.bestSize, d.size);
        if (caughtStr > existing.lastCaught) existing.lastCaught = caughtStr;
      }
    }

    const result = Array.from(byItemType.entries()).map(([itemType, agg]) => ({
      itemType,
      count: agg.count,
      bestSize: agg.bestSize,
      lastCaught: agg.lastCaught,
    }));

    success(res, result);
  }),
);

/**
 * GET /game/recipe-journal
 *
 * Returns all cooking recipes with the current user's discovered/undiscovered status.
 */
router.get(
  '/recipe-journal',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return success(res, { recipes: [], discoveredCount: 0, totalCount: 0 });
    const journal = await cookingService.getJournal(userId);
    success(res, journal);
  }),
);

/**
 * GET /game/craft-journal
 *
 * Returns all crafting recipes with the current user's discovered/undiscovered status.
 */
router.get(
  '/craft-journal',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return success(res, { recipes: [], discoveredCount: 0, totalCount: 0 });
    const journal = await craftingService.getJournal(userId);
    success(res, journal);
  }),
);

/**
 * GET /game/scenes/:slug
 *
 * Returns a scene's layout data (dimensions, bgColor, placements) for
 * multiplayer scene rendering on the client.
 */
router.get(
  '/scenes/:slug',
  protect,
  catchAsync(async (req, res) => {
    const scene = await Scene.findOne({ slug: req.params.slug }).lean();
    if (!scene) {
      res.status(404).json({ ok: false, message: 'Scene not found' });
      return;
    }
    success(res, {
      slug: scene.slug,
      name: scene.name,
      cols: scene.cols,
      rows: scene.rows,
      bgColor: scene.bgColor,
      tiledFlooringItemType: scene.tiledFlooringItemType ?? null,
      grassNoiseStrength: scene.grassNoiseStrength,
      farmCols: scene.farmCols,
      farmRows: scene.farmRows,
      placements: scene.placements,
      walkableRect: scene.walkableRect ?? null,
      unwalkableTiles: scene.unwalkableTiles ?? [],
      fishingTiles: scene.fishingTiles ?? [],
      bakedImageUrl: scene.bakedImageUrl ?? null,
      spawnX: scene.spawnX,
      spawnY: scene.spawnY,
    });
  }),
);

export default router;
