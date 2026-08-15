/**
 * Parse hatchly-app-2026/seeds.txt and upsert soil crop GameItemDefs
 * (seed packet + harvest produce). Skips Sapling / World Tree rows — fruit
 * trees live in TreeService already.
 *
 * Growth times:
 *   T1 — wheat 30s; others 3m → 2h 30m
 *   T2 — 4h → 10h 40m
 *   T3 — 14h → 20h
 *   T4 — 24h → 38h
 *   T5 — 42h → 52h
 *   T6+ — 54h+ (event / reserved)
 *
 * Usage:
 *   npm run seed:seeds
 *   npm run seed:seeds -- --generate-images
 *   npm run seed:seed-images
 */
import fs from 'node:fs';
import path from 'node:path';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { createLogger } from '../config/logger.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { openAIService } from '../services/OpenAIService.js';
import { storageService } from '../services/StorageService.js';
import {
  FARMING_SEED_SHOP_DEFAULT_PRICES,
  produceSellPriceFromSeedBuy,
  seedSellPriceFromBuy,
} from '../constants/farmingLevelSeedShopUnlocks.js';
import { resolveCropGrowthMs } from '../constants/farmingCropGrowth.js';

const log = createLogger('SeedCrops');

const STYLE_FRAGMENT =
  `Art style: flat vector illustration with thick uniform black outlines, ` +
  `soft cel-shaded coloring with one highlight and one shadow tone per surface, no gradients. ` +
  `Perspective: front-facing view, similar to stardew valley, centered in frame. ` +
  `Proportions: slightly chunky and rounded for a friendly, cute aesthetic. ` +
  `Lighting: soft diffused light from the upper left, no drop shadow. ` +
  `Transparent PNG background, no ground plane, no extra props or decorations. ` +
  `The asset should fill roughly 95% of the image.`;

const SEEDS_TXT = path.resolve(process.cwd(), '../hatchly-app-2026/seeds.txt');

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Map preferred slugs onto existing DB itemTypes. */
const SEED_ALIASES: Record<string, string> = {
  tomato_seed: 'tomato_seeds',
  watermelon_seed: 'watermelon_seeds',
};

const PRODUCE_ALIASES: Record<string, string> = {
  dragonfruit: 'dragon_fruit',
  green_onion: 'green_onion',
};

type Tier = 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface ParsedPlant {
  tier: Tier;
  seedItemType: string;
  seedLabel: string;
  produceItemType: string;
  produceLabel: string;
  growthMs: number;
  /** T1 only — raw grow string from txt for logging. */
  growHint?: string;
}

const TIER_GROWTH: Record<Exclude<Tier, 1>, [number, number]> = {
  2: [4 * HOUR, 11 * HOUR],
  3: [14 * HOUR, 20 * HOUR],
  4: [24 * HOUR, 38 * HOUR],
  5: [42 * HOUR, 52 * HOUR],
  6: [54 * HOUR, 66 * HOUR],
  7: [72 * HOUR, 96 * HOUR],
};

const TIER_EMOJI: Record<Tier, string> = {
  1: '🌾',
  2: '🥕',
  3: '🍓',
  4: '🌿',
  5: '🌺',
  6: '🍄',
  7: '✨',
};

const TIER_COLOR: Record<Tier, string> = {
  1: '#C4A574',
  2: '#7CB342',
  3: '#E57373',
  4: '#66BB6A',
  5: '#F48FB1',
  6: '#A1887F',
  7: '#CE93D8',
};

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function resolveSeedItemType(seedLabel: string): string {
  let base = slugify(seedLabel);
  // Normalize "seeds" plural endings already in slug
  if (SEED_ALIASES[base]) return SEED_ALIASES[base];
  return base;
}

function produceFromSeedLabel(seedLabel: string): { label: string; itemType: string } {
  let label = seedLabel
    .replace(/\s+Seeds?$/i, '')
    .replace(/\s+Spores$/i, '')
    .replace(/\s+Bulb$/i, '')
    .trim();
  if (/mushroom/i.test(seedLabel) && !/mushroom/i.test(label)) {
    label = `${label} Mushroom`;
  }
  let itemType = slugify(label);
  if (PRODUCE_ALIASES[itemType]) itemType = PRODUCE_ALIASES[itemType];
  return { label, itemType };
}

function resolveTypes(seedLabel: string, harvestHint?: string): {
  seedItemType: string;
  seedLabel: string;
  produceItemType: string;
  produceLabel: string;
} {
  const hasAffix = /\b(seeds?|spores|bulb)$/i.test(seedLabel.trim());
  if (hasAffix) {
    const produce = produceFromSeedLabel(seedLabel);
    return {
      seedItemType: resolveSeedItemType(seedLabel),
      seedLabel,
      produceItemType: produce.itemType,
      produceLabel: produce.label,
    };
  }

  // Bare crop name (e.g. "Wheat") — seed is <name>_seed, produce from harvest col or name
  const produceLabel = (harvestHint && harvestHint.trim()) || seedLabel.trim();
  let produceItemType = slugify(produceLabel);
  if (PRODUCE_ALIASES[produceItemType]) produceItemType = PRODUCE_ALIASES[produceItemType];
  const seedLabelFull = /seed$/i.test(seedLabel) ? seedLabel : `${produceLabel} Seed`;
  return {
    seedItemType: resolveSeedItemType(seedLabelFull),
    seedLabel: seedLabelFull,
    produceItemType,
    produceLabel,
  };
}

function parseGrowMs(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  const m = /^(\d+)\s*(s|m|h|min|sec|hour|hours)?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? 's';
  if (unit.startsWith('h')) return n * HOUR;
  if (unit.startsWith('m')) return n * MINUTE;
  return n * 1000;
}

function spreadMs(min: number, max: number, index: number, count: number): number {
  if (count <= 1) return Math.round((min + max) / 2);
  const t = index / (count - 1);
  return Math.round(min + (max - min) * t);
}

function detectTier(contents: string): { tier: Tier; start: number }[] {
  const lines = contents.split(/\r?\n/);
  const markers: { tier: Tier; start: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/Tier 1/i.test(line)) markers.push({ tier: 1, start: i });
    else if (/Tier 2/i.test(line)) markers.push({ tier: 2, start: i });
    else if (/Tier 3/i.test(line)) markers.push({ tier: 3, start: i });
    else if (/Tier 4/i.test(line)) markers.push({ tier: 4, start: i });
    else if (/Tier 5/i.test(line)) markers.push({ tier: 5, start: i });
    else if (/Tier 6/i.test(line)) markers.push({ tier: 6, start: i });
    else if (/Tier 7/i.test(line)) markers.push({ tier: 7, start: i });
    else if (/Processing Recipes/i.test(line)) break;
  }
  return markers;
}

function parseSeedsTxt(contents: string): ParsedPlant[] {
  const lines = contents.split(/\r?\n/);
  const markers = detectTier(contents);
  const plants: ParsedPlant[] = [];
  const bySeed = new Map<string, ParsedPlant>();

  for (let mi = 0; mi < markers.length; mi++) {
    const { tier, start } = markers[mi];
    const end = mi + 1 < markers.length ? markers[mi + 1].start : lines.findIndex((l, i) => i > start && /Processing Recipes/i.test(l));
    const endIdx = end < 0 ? lines.length : end;
    const tierRows: { seedLabel: string; growHint?: string; harvestHint?: string }[] = [];

    for (let i = start + 1; i < endIdx; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (/^\(/.test(line)) continue;
      if (/^Seed\t/i.test(line)) continue;
      if (/^🌾|^🥕|^🍓|^🌿|^🌺|^🍄|^✨/.test(line) && /Tier/i.test(line)) continue;

      // Tabular: Seed \t Grow \t Harvest?
      if (line.includes('\t')) {
        const parts = line.split('\t').map((p) => p.trim());
        const seedLabel = parts[0];
        if (!seedLabel || /^seed$/i.test(seedLabel)) continue;
        if (/sapling/i.test(seedLabel) || /world tree/i.test(seedLabel)) continue;
        tierRows.push({ seedLabel, growHint: parts[1], harvestHint: parts[2] });
        continue;
      }

      // Bare name rows (herbs, flowers, mushrooms, exotic)
      if (/sapling/i.test(line) || /world tree/i.test(line)) continue;
      if (/seed|spores|bulb/i.test(line)) {
        tierRows.push({ seedLabel: line });
      }
    }

    tierRows.forEach((row, index) => {
      const types = resolveTypes(row.seedLabel, row.harvestHint);
      let growthMs: number;
      if (tier === 1) {
        growthMs = (row.growHint && parseGrowMs(row.growHint)) || 120_000;
      } else {
        const [min, max] = TIER_GROWTH[tier];
        growthMs = spreadMs(min, max, index, tierRows.length);
      }
      growthMs = resolveCropGrowthMs(types.seedItemType, growthMs);

      const plant: ParsedPlant = {
        tier,
        seedItemType: types.seedItemType,
        seedLabel: types.seedLabel,
        produceItemType: types.produceItemType,
        produceLabel: types.produceLabel,
        growthMs,
        growHint: row.growHint,
      };
      if (!bySeed.has(types.seedItemType)) {
        bySeed.set(types.seedItemType, plant);
        plants.push(plant);
      }
    });
  }

  return plants;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function generateCropImage(
  itemType: string,
  label: string,
  kind: 'seed' | 'produce',
): Promise<string> {
  const subject =
    kind === 'seed'
      ? `a small pile of ${label.toLowerCase()} for planting, cozy farming game seed packet icon`
      : `a single harvested ${label.toLowerCase()}, 2D game sprite for a cozy farming game`;
  const prompt = `${subject}. ${STYLE_FRAGMENT}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const base64DataUri = await openAIService.generateImageBase64(prompt, {
        model: 'gpt-image-1',
        size: '1024x1024',
        quality: 'medium',
        background: 'transparent',
      });
      return await storageService.uploadBase64(base64DataUri, `game-items/${itemType}`);
    } catch (err) {
      lastErr = err;
      log.warn({ err, itemType, attempt }, 'Image generation failed; retrying');
      await sleep(2000 * attempt);
    }
  }
  throw lastErr;
}

async function upsertSeed(plant: ParsedPlant): Promise<'created' | 'updated'> {
  const existing = await GameItemDef.findOne({ itemType: plant.seedItemType });
  const harvestYield = [{ itemType: plant.produceItemType, qty: 1 }];
  const buy =
    typeof existing?.gemPrice === 'number' && existing.gemPrice > 0
      ? existing.gemPrice
      : (FARMING_SEED_SHOP_DEFAULT_PRICES[plant.seedItemType] ?? 0);
  const sellPrice = buy > 0 ? seedSellPriceFromBuy(buy) : Math.max(1, Math.floor((5 + plant.tier * 3) / 2));

  const payload = {
    label: plant.seedLabel,
    emoji: TIER_EMOJI[plant.tier],
    color: TIER_COLOR[plant.tier],
    category: 'seed' as const,
    placeable: true,
    cols: 1,
    rows: 1,
    sellable: true,
    sellPrice,
    growthMs: plant.growthMs,
    harvestYield,
    gemsGiven: Math.max(1, plant.tier),
  };

  if (!existing) {
    await GameItemDef.create({ itemType: plant.seedItemType, ...payload });
    return 'created';
  }

  existing.label = payload.label;
  existing.emoji = payload.emoji;
  existing.color = payload.color;
  existing.category = 'seed';
  existing.placeable = true;
  existing.cols = 1;
  existing.rows = 1;
  existing.sellable = true;
  existing.sellPrice = payload.sellPrice;
  existing.growthMs = payload.growthMs;
  existing.harvestYield = payload.harvestYield;
  existing.gemsGiven = payload.gemsGiven;
  await existing.save();
  return 'updated';
}

async function upsertProduce(plant: ParsedPlant): Promise<'created' | 'updated'> {
  const existing = await GameItemDef.findOne({ itemType: plant.produceItemType });
  const seed = await GameItemDef.findOne({ itemType: plant.seedItemType }).lean();
  const buy =
    typeof seed?.gemPrice === 'number' && seed.gemPrice > 0
      ? seed.gemPrice
      : (FARMING_SEED_SHOP_DEFAULT_PRICES[plant.seedItemType] ?? 0);
  const isFood = plant.tier === 3 || plant.tier >= 5 || /berry|fruit|mushroom/i.test(plant.produceLabel);
  const payload = {
    label: plant.produceLabel,
    emoji: TIER_EMOJI[plant.tier],
    color: TIER_COLOR[plant.tier],
    category: (isFood ? 'food' : 'ingredient') as 'food' | 'ingredient',
    placeable: false,
    cols: 1,
    rows: 1,
    sellable: true,
    sellPrice: buy > 0 ? produceSellPriceFromSeedBuy(buy, plant.growthMs) : 8 + plant.tier * 5,
    foodHunger: isFood ? 8 + plant.tier * 2 : undefined,
    foodHappiness: isFood ? 4 + plant.tier : undefined,
  };

  if (!existing) {
    await GameItemDef.create({
      itemType: plant.produceItemType,
      ...payload,
      harvestYield: [],
    });
    return 'created';
  }

  // Preserve existing food/ingredient category if already set meaningfully
  if (existing.category !== 'food' && existing.category !== 'ingredient') {
    existing.category = payload.category;
  }
  existing.label = payload.label;
  existing.emoji = payload.emoji;
  existing.color = payload.color;
  existing.placeable = false;
  existing.sellable = true;
  if (buy > 0 || existing.sellPrice == null || existing.sellPrice === 0) {
    existing.sellPrice = payload.sellPrice;
  }
  if (payload.foodHunger != null && existing.foodHunger == null) {
    existing.foodHunger = payload.foodHunger;
    existing.foodHappiness = payload.foodHappiness;
  }
  await existing.save();
  return 'updated';
}

async function main(): Promise<void> {
  const generateImages = process.argv.includes('--generate-images');
  const concurrencyArg = process.argv.find((a) => a.startsWith('--concurrency='));
  const concurrency = Math.max(
    1,
    Math.min(12, Number(concurrencyArg?.split('=')[1] ?? 6) || 6),
  );

  if (!fs.existsSync(SEEDS_TXT)) {
    log.fatal({ path: SEEDS_TXT }, 'seeds.txt not found');
    process.exit(1);
  }

  const plants = parseSeedsTxt(fs.readFileSync(SEEDS_TXT, 'utf8'));
  const byTier = Object.fromEntries(
    ([1, 2, 3, 4, 5, 6, 7] as Tier[]).map((t) => [t, plants.filter((p) => p.tier === t).length]),
  );
  log.info({ count: plants.length, byTier, generateImages, concurrency }, 'Parsed seeds.txt');

  await connectDatabase();

  let seedCreated = 0;
  let seedUpdated = 0;
  let produceCreated = 0;
  let produceUpdated = 0;

  for (const plant of plants) {
    const s = await upsertSeed(plant);
    if (s === 'created') seedCreated += 1;
    else seedUpdated += 1;
    const p = await upsertProduce(plant);
    if (p === 'created') produceCreated += 1;
    else produceUpdated += 1;
  }

  log.info(
    { seedCreated, seedUpdated, produceCreated, produceUpdated },
    'Crop defs upserted',
  );

  if (generateImages) {
    const seedTypes = plants.map((p) => p.seedItemType);
    const produceTypes = plants.map((p) => p.produceItemType);
    const needsArt = await GameItemDef.find({
      itemType: { $in: [...seedTypes, ...produceTypes] },
      $or: [{ imageUrl: { $exists: false } }, { imageUrl: null }, { imageUrl: '' }],
    }).select('itemType label category');

    const produceSet = new Set(produceTypes);
    log.info({ count: needsArt.length, concurrency }, 'Generating missing crop images');

    let ok = 0;
    let failed = 0;
    let cursor = 0;

    async function worker(): Promise<void> {
      while (cursor < needsArt.length) {
        const index = cursor;
        cursor += 1;
        const item = needsArt[index];
        const kind: 'seed' | 'produce' = produceSet.has(item.itemType) ? 'produce' : 'seed';
        try {
          const imageUrl = await generateCropImage(item.itemType, item.label, kind);
          item.imageUrl = imageUrl;
          await item.save();
          ok += 1;
          log.info(
            { itemType: item.itemType, kind, done: ok, left: needsArt.length - ok - failed },
            'Crop image saved',
          );
        } catch (err) {
          failed += 1;
          log.error({ err, itemType: item.itemType }, 'Crop image generation failed');
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, Math.max(1, needsArt.length)) }, () => worker()),
    );
    log.info({ ok, failed }, 'Image generation finished');
  }

  await disconnectDatabase();
  log.info('Done');
}

main().catch(async (err) => {
  console.error(err);
  try {
    await disconnectDatabase();
  } catch {
    // ignore
  }
  process.exit(1);
});
