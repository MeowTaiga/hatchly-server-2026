import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { farmService, FARM_LEVELS } from '../services/FarmService.js';
import { questService } from '../services/quests/index.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { ShopBanner } from '../models/ShopBanner.js';
import { UserCollection } from '../models/UserCollection.js';
import { UserQuest } from '../models/UserQuest.js';
import { QuestDef } from '../models/QuestDef.js';
import { Farm } from '../models/Farm.js';
import { FossilLootConfig } from '../models/FossilLootConfig.js';
import { Scene } from '../models/Scene.js';
import { CollectionSetDef } from '../models/CollectionSetDef.js';
import { cookingService } from '../services/CookingService.js';
import { craftingService } from '../services/CraftingService.js';
import { smeltingService } from '../services/SmeltingService.js';
import { weatherService } from '../services/WeatherService.js';
import { evaluateRequirements } from '../services/quests/requirements.js';

const router = Router();

/**
 * GET /game/weather
 *
 * Shared world weather for the America/New_York calendar day (no external API).
 */
router.get(
  '/weather',
  protect,
  catchAsync(async (_req, res) => {
    success(res, weatherService.getActiveWeather());
  }),
);

/**
 * GET /game/summary
 *
 * Lightweight summary for home tab: farm, gems, quests, collection & recipe progress.
 */
router.get(
  '/summary',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      return success(res, {
        farmLevel: 1,
        gems: 0,
        questCount: 0,
        farmLevelTitle: 'Seedling',
        farmLevelEmoji: '🌱',
        xpProgress: 0,
        activeQuestTitles: [],
        fishCaught: 0,
        fishTotal: 0,
        bugsCaught: 0,
        bugsTotal: 0,
        recipesDiscovered: 0,
        recipesTotal: 0,
        craftsDiscovered: 0,
        craftsTotal: 0,
      });
    }

    const farm = await farmService.loadOrCreateFarm(userId);
    const level = farmService.farmLevelOf(farm);
    const { quests } = await questService.sync(userId);
    const activeQuests = quests.filter((q) => q.status === 'active');
    const nextLevel = FARM_LEVELS.find((l) => l.level === level.level + 1);
    const xpInLevel = farm.xp - level.xpRequired;
    const xpNeeded = nextLevel ? nextLevel.xpRequired - level.xpRequired : 0;
    const xpProgress = xpNeeded > 0 ? Math.min(100, Math.round((xpInLevel / xpNeeded) * 100)) : 100;

    const [
      fishCaught,
      fishTotal,
      bugsCaught,
      bugsTotal,
      cookingJournal,
      craftJournal,
    ] = await Promise.all([
      UserCollection.countDocuments({ userId, category: 'fish' }),
      GameItemDef.countDocuments({ category: 'fish' }),
      UserCollection.countDocuments({ userId, category: 'bug' }),
      GameItemDef.countDocuments({ category: 'bug' }),
      cookingService.getJournal(userId),
      craftingService.getJournal(userId),
    ]);

    success(res, {
      farmLevel: level.level,
      gems: farm.gems,
      questCount: activeQuests.length,
      farmLevelTitle: level.title,
      farmLevelEmoji: level.emoji,
      xpProgress,
      activeQuestTitles: activeQuests.slice(0, 3).map((q) => q.title),
      fishCaught,
      fishTotal,
      bugsCaught,
      bugsTotal,
      recipesDiscovered: cookingJournal.discoveredCount,
      recipesTotal: cookingJournal.totalCount,
      craftsDiscovered: craftJournal.discoveredCount,
      craftsTotal: craftJournal.totalCount,
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
 * Returns the user's caught items plus the full catalog for that museum tab.
 *
 * Finds (discoverables) are loot-table driven — their item defs often live under
 * other categories (materials, etc.), so counting `category === 'discoverables'`
 * on the client always under-counted the shelf.
 */
router.get(
  '/collection',
  protect,
  catchAsync(async (req, res) => {
    const empty = { items: [] as const, catalog: [] as const };
    const userId = req.user?.id;
    if (!userId) return success(res, empty);

    const category = (req.query.category as string) || 'bug';
    const valid = ['bug', 'fish', 'discoverables'];
    if (!valid.includes(category)) return success(res, empty);

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

    const items = Array.from(byItemType.entries()).map(([itemType, agg]) => ({
      itemType,
      count: agg.count,
      bestSize: agg.bestSize,
      lastCaught: agg.lastCaught,
    }));

    // Authoritative museum shelf for this tab.
    let catalog: { itemType: string; rarity: string }[] = [];
    if (category === 'discoverables') {
      const loot = await FossilLootConfig.findOne().lean();
      const seen = new Set<string>();
      for (const entry of loot?.entries ?? []) {
        if (seen.has(entry.itemType)) continue;
        seen.add(entry.itemType);
        catalog.push({ itemType: entry.itemType, rarity: entry.rarity ?? 'common' });
      }
      // Anything already collected but missing from the loot table still belongs.
      for (const itemType of byItemType.keys()) {
        if (seen.has(itemType)) continue;
        seen.add(itemType);
        catalog.push({ itemType, rarity: 'common' });
      }
    } else {
      const defs = await GameItemDef.find({ category }).select('itemType bugRarity fishRarity').lean();
      catalog = defs.map((d) => ({
        itemType: d.itemType,
        rarity: (category === 'fish' ? d.fishRarity : d.bugRarity) ?? 'common',
      }));
    }

    success(res, { items, catalog });
  }),
);

/**
 * GET /game/collection-sets?category=fish
 *
 * Returns themed collection set defs with per-user progress (caught unique / total).
 * Completing a set is informational only in v1 — no claim/rewards yet.
 */
router.get(
  '/collection-sets',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    const category = ((req.query.category as string) || 'fish') as 'fish' | 'bug';
    if (!userId || (category !== 'fish' && category !== 'bug')) {
      return success(res, { sets: [] });
    }

    const sets = await CollectionSetDef.find({ category }).sort({ sortOrder: 1 }).lean();
    if (sets.length === 0) return success(res, { sets: [] });

    const allTypes = Array.from(new Set(sets.flatMap((s) => s.itemTypes)));
    const caughtDocs = allTypes.length
      ? await UserCollection.find({
          userId,
          category,
          itemType: { $in: allTypes },
        })
          .select('itemType')
          .lean()
      : [];
    const caught = new Set(caughtDocs.map((d) => d.itemType));

    success(res, {
      sets: sets.map((s) => {
        const total = s.itemTypes.length;
        const caughtCount = s.itemTypes.filter((t) => caught.has(t)).length;
        return {
          setId: s.setId,
          label: s.label,
          category: s.category,
          emoji: s.emoji ?? null,
          description: s.description ?? null,
          sortOrder: s.sortOrder,
          itemTypes: s.itemTypes,
          total,
          caught: caughtCount,
          complete: total > 0 && caughtCount >= total,
        };
      }),
    });
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
 * GET /game/smelt-journal
 */
router.get(
  '/smelt-journal',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return success(res, { recipes: [], discoveredCount: 0, totalCount: 0 });
    const journal = await smeltingService.getJournal(userId);
    success(res, journal);
  }),
);

/**
 * GET /game/quest-journal
 *
 * Completed quests for the museum's Quests tab — full def info (dialog,
 * steps, rewards) plus when each one was finished. Newest completions first.
 */
router.get(
  '/quest-journal',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return success(res, { quests: [] });

    const rows = await UserQuest.find({ userId, status: 'completed' })
      .sort({ completedAt: -1 })
      .lean();

    if (rows.length === 0) return success(res, { quests: [] });

    const [defs, farm, labelDocs] = await Promise.all([
      QuestDef.find({ questId: { $in: rows.map((r) => r.questId) } }).lean(),
      Farm.findOne({ userId }),
      GameItemDef.find({}, { itemType: 1, label: 1 }).lean(),
    ]);
    const defById = new Map(defs.map((d) => [d.questId, d]));
    const itemLabels = new Map(labelDocs.map((d) => [d.itemType, d.label]));

    const quests = rows.map((row) => {
      const def = defById.get(row.questId);
      const clauses =
        def && farm
          ? evaluateRequirements(def.requirements, {
              farm,
              userQuest: row as never,
              itemLabels,
            }).map((c) => ({
              key: c.key,
              kind: c.kind,
              label: c.label,
              itemType: c.itemType,
              have: c.need,
              need: c.need,
              met: true,
            }))
          : [];

      return {
        questId: row.questId,
        title: def?.title ?? row.questId,
        description: def?.description ?? '',
        type: def?.type ?? 'story',
        farmLevel: def?.farmLevel,
        farmLevelMin: def?.farmLevelMin,
        rewards: def?.rewards ?? {},
        clauses,
        startDialog: def?.startDialog?.length ? def.startDialog : undefined,
        endDialog: def?.endDialog?.length ? def.endDialog : undefined,
        startDialogSpeaker: def?.startDialogSpeaker,
        endDialogSpeaker: def?.endDialogSpeaker,
        completedAt: row.completedAt
          ? (row.completedAt instanceof Date ? row.completedAt.toISOString() : String(row.completedAt))
          : (row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt)),
      };
    });

    success(res, { quests });
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
      tiledFlooringStyle: scene.tiledFlooringStyle ?? null,
      grassNoiseStrength: scene.grassNoiseStrength,
      farmCols: scene.farmCols,
      farmRows: scene.farmRows,
      placements: scene.placements,
      walkableRect: scene.walkableRect ?? null,
      unwalkableTiles: scene.unwalkableTiles ?? [],
      fishingTiles: scene.fishingTiles ?? [],
      miningTiles: scene.miningTiles ?? [],
      bakedImageUrl: scene.bakedImageUrl ?? null,
      spawnX: scene.spawnX,
      spawnY: scene.spawnY,
    });
  }),
);

export default router;
