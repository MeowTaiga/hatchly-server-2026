/**
 * Parse hatchly-app-2026/fishes.txt and upsert fish GameItemDefs + CollectionSetDefs.
 *
 * Usage:
 *   npm run seed:fish
 *   npm run seed:fish -- --generate-images
 *
 * Upserts by itemType (preserves existing imageUrl). Optional --generate-images
 * fills missing art via OpenAI with rate limiting.
 */
import fs from 'node:fs';
import path from 'node:path';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { createLogger } from '../config/logger.js';
import { GameItemDef, type BugActiveTime, type BugRarity } from '../models/GameItemDef.js';
import { CollectionSetDef } from '../models/CollectionSetDef.js';
import { openAIService } from '../services/OpenAIService.js';
import { storageService } from '../services/StorageService.js';

const log = createLogger('SeedFish');

const STYLE_FRAGMENT_FISH =
  `Art style: flat vector illustration with thick uniform black outlines, ` +
  `soft cel-shaded coloring with one highlight and one shadow tone per surface, no gradients. ` +
  `Perspective: side-facing view, swimming left, similar to stardew valley, centered in frame. ` +
  `Proportions: slightly chunky and rounded for a friendly, cute aesthetic. ` +
  `Lighting: soft diffused light from the upper left, no drop shadow. ` +
  `Transparent PNG background, no ground plane, no extra props or decorations. ` +
  `The asset should fill roughly 95% of the image.`;

const FISHES_TXT = path.resolve(process.cwd(), '../hatchly-app-2026/fishes.txt');

/** Map txt names onto existing DB slugs when they differ. */
const ITEM_TYPE_ALIASES: Record<string, string> = {
  clownfish: 'clown_fish',
  pufferfish: 'puffer_fish',
};

type FishSpot = 'pond' | 'river' | 'ocean' | 'lake' | 'reef';
type TxtRarity = 'common' | 'rare' | 'unique' | 'legendary' | 'mythic';

interface ParsedFish {
  itemType: string;
  label: string;
  rarity: TxtRarity;
  spot: FishSpot;
  activeTime: BugActiveTime;
  collectionTags: string[];
  /** True if this row came from the Autumn Exclusive section. */
  isEvent: boolean;
}

const SELL_RANGES: Record<TxtRarity, [number, number]> = {
  common: [10, 30],
  rare: [35, 50],
  unique: [150, 599],
  legendary: [600, 2000],
  mythic: [2001, 20000],
};

const SIZE_RANGES: Record<TxtRarity, [number, number]> = {
  common: [0.4, 1.2],
  rare: [0.5, 1.5],
  unique: [0.8, 2.0],
  legendary: [1.2, 3.0],
  mythic: [2.0, 5.0],
};

const RARITY_EMOJI: Record<TxtRarity, string> = {
  common: '🐟',
  rare: '💎',
  unique: '⭐',
  legendary: '👑',
  mythic: '🌌',
};

const RARITY_COLOR: Record<TxtRarity, string> = {
  common: '#7CB9E8',
  rare: '#38BDF8',
  unique: '#A78BFA',
  legendary: '#F59E0B',
  mythic: '#F472B6',
};

const CELESTIAL_TYPES = new Set([
  'celestial_trout',
  'galactic_trout',
  'nebula_flounder',
  'astral_ray',
  'cosmic_koi',
  'stardust_angelfish',
  'starfall_snapper',
  'starlight_mackerel',
  'celestfin_salmon',
  'aurora_whalefish',
  'infinity_goldfish',
]);

const ANCIENT_TYPES = new Set([
  'ancient_carp',
  'timekeeper_trout',
  'worldtree_carp',
  'echo_trout',
  'void_eel',
]);

const ROYAL_TYPES = new Set([
  'royal_moonfish',
  'crown_pike',
  'phoenix_koi',
]);

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function sellPriceFor(itemType: string, rarity: TxtRarity): number {
  const [lo, hi] = SELL_RANGES[rarity];
  return lo + (hashStr(itemType) % (hi - lo + 1));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function resolveItemType(label: string): string {
  const slug = slugify(label);
  return ITEM_TYPE_ALIASES[slug] ?? slug;
}

function mapLocation(location: string): FishSpot {
  const l = location.toLowerCase();
  if (l.includes('reef') || l.includes('coral')) return 'reef';
  if (l.includes('ocean') || l === 'abyss') return 'ocean';
  if (l.includes('lake') || l.includes('sacred grove')) return 'lake';
  if (l.includes('river') || l.includes('creek')) return 'river';
  if (l.includes('pond') || l.includes('swamp') || l.includes('marsh')) return 'pond';
  return 'pond';
}

function mapTime(raw: string): BugActiveTime {
  const t = raw.toLowerCase();
  if (/\b(midnight|night)\b/.test(t)) return 'night';
  if (/\b(morning|dawn|sunrise)\b/.test(t)) return 'morning';
  if (/\b(evening|sunset|dusk|day|noon)\b/.test(t)) return 'afternoon';
  return 'all_day';
}

function parseFishesTxt(contents: string): ParsedFish[] {
  const lines = contents.split(/\r?\n/);
  let section: TxtRarity | 'autumn' | null = null;
  const byType = new Map<string, ParsedFish>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^🌊\s*Common/i.test(line)) {
      section = 'common';
      continue;
    }
    if (/^💎\s*Rare/i.test(line)) {
      section = 'rare';
      continue;
    }
    if (/^⭐\s*Unique/i.test(line)) {
      section = 'unique';
      continue;
    }
    if (/^👑\s*Legendary/i.test(line)) {
      section = 'legendary';
      continue;
    }
    if (/^🌌\s*Mythic/i.test(line)) {
      section = 'mythic';
      continue;
    }
    if (/^🎃\s*Autumn/i.test(line)) {
      section = 'autumn';
      continue;
    }
    if (/^Fishing Locations/i.test(line) || /^Time Categories/i.test(line)) {
      section = null;
      continue;
    }
    if (!section) continue;
    if (/^Fish\tLocation\tTime$/i.test(line) || /^These only appear/i.test(line)) continue;
    if (!line.includes('\t')) continue;

    const parts = line.split('\t').map((p) => p.trim());
    if (parts.length < 3) continue;
    const [label, location, time] = parts;
    if (!label || label === 'Fish') continue;

    const itemType = resolveItemType(label);
    const isEvent = section === 'autumn';
    const rarity: TxtRarity = isEvent ? 'unique' : section;
    const spot = mapLocation(location);
    const activeTime = mapTime(time);
    const collectionTags = isEvent ? ['ghost'] : [];

    const existing = byType.get(itemType);
    if (existing) {
      // Duplicate rows (e.g. Phantom Pike in Unique + Autumn): keep gameplay from first, merge tags.
      if (isEvent && !existing.collectionTags.includes('ghost')) {
        existing.collectionTags.push('ghost');
      }
      continue;
    }

    byType.set(itemType, {
      itemType,
      label,
      rarity,
      spot,
      activeTime,
      collectionTags,
      isEvent,
    });
  }

  return Array.from(byType.values());
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function generateFishImage(itemType: string, label: string): Promise<string> {
  const prompt =
    `A single ${label.toLowerCase()}, 2D game sprite for a cozy top-down farming game. ${STYLE_FRAGMENT_FISH}`;
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

async function upsertFish(fish: ParsedFish): Promise<'created' | 'updated'> {
  const existing = await GameItemDef.findOne({ itemType: fish.itemType });
  const [sizeMin, sizeMax] = SIZE_RANGES[fish.rarity];
  const sellPrice = sellPriceFor(fish.itemType, fish.rarity);
  const payload = {
    label: fish.label,
    emoji: fish.isEvent ? '🎃' : RARITY_EMOJI[fish.rarity],
    color: RARITY_COLOR[fish.rarity],
    category: 'fish' as const,
    placeable: false,
    cols: 1,
    rows: 1,
    sellable: true,
    sellPrice,
    fishRarity: fish.rarity as BugRarity,
    fishActiveTime: fish.activeTime,
    fishSpotTypes: [fish.spot],
    fishSizeMin: sizeMin,
    fishSizeMax: sizeMax,
    fishCollectionTags: fish.collectionTags.length ? fish.collectionTags : undefined,
  };

  if (!existing) {
    await GameItemDef.create({ itemType: fish.itemType, ...payload });
    return 'created';
  }

  existing.label = payload.label;
  existing.emoji = payload.emoji;
  existing.color = payload.color;
  existing.category = 'fish';
  existing.placeable = false;
  existing.sellable = true;
  existing.sellPrice = sellPrice;
  existing.fishRarity = payload.fishRarity;
  existing.fishActiveTime = payload.fishActiveTime;
  existing.fishSpotTypes = payload.fishSpotTypes;
  existing.fishSizeMin = sizeMin;
  existing.fishSizeMax = sizeMax;
  existing.fishCollectionTags = payload.fishCollectionTags;
  // Preserve imageUrl / directionalImages / etc.
  await existing.save();
  return 'updated';
}

async function seedCollectionSets(fish: ParsedFish[]): Promise<void> {
  const nonEvent = fish.filter((f) => !f.isEvent);
  const bySpot = (spot: FishSpot) =>
    nonEvent.filter((f) => f.spot === spot).map((f) => f.itemType);

  const ghost = fish
    .filter((f) => f.collectionTags.includes('ghost'))
    .map((f) => f.itemType);

  const sets: Array<{
    setId: string;
    label: string;
    emoji: string;
    description: string;
    sortOrder: number;
    itemTypes: string[];
  }> = [
    {
      setId: 'fish_pond',
      label: 'Pond',
      emoji: '🌸',
      description: 'Quiet waters and garden ponds.',
      sortOrder: 1,
      itemTypes: bySpot('pond'),
    },
    {
      setId: 'fish_river',
      label: 'River',
      emoji: '🏞️',
      description: 'Currents, creeks, and mountain streams.',
      sortOrder: 2,
      itemTypes: bySpot('river'),
    },
    {
      setId: 'fish_lake',
      label: 'Lake',
      emoji: '🏕️',
      description: 'Still lakes and sacred groves.',
      sortOrder: 3,
      itemTypes: bySpot('lake'),
    },
    {
      setId: 'fish_ocean',
      label: 'Ocean',
      emoji: '🌊',
      description: 'Open seas and the deep abyss.',
      sortOrder: 4,
      itemTypes: bySpot('ocean'),
    },
    {
      setId: 'fish_reef',
      label: 'Reef',
      emoji: '🪸',
      description: 'Coral gardens and reef shallows.',
      sortOrder: 5,
      itemTypes: bySpot('reef'),
    },
    {
      setId: 'fish_ghost',
      label: 'Ghost',
      emoji: '🎃',
      description: 'Autumn-exclusive spooky catches.',
      sortOrder: 6,
      itemTypes: ghost,
    },
    {
      setId: 'fish_celestial',
      label: 'Celestial',
      emoji: '✨',
      description: 'Starlit and cosmic legendaries.',
      sortOrder: 7,
      itemTypes: fish.filter((f) => CELESTIAL_TYPES.has(f.itemType)).map((f) => f.itemType),
    },
    {
      setId: 'fish_ancient',
      label: 'Ancient',
      emoji: '🏛️',
      description: 'Temple waters and timeworn relics.',
      sortOrder: 8,
      itemTypes: fish.filter((f) => ANCIENT_TYPES.has(f.itemType)).map((f) => f.itemType),
    },
    {
      setId: 'fish_royal',
      label: 'Royal',
      emoji: '👑',
      description: 'Crown jewels of the deep.',
      sortOrder: 9,
      itemTypes: fish.filter((f) => ROYAL_TYPES.has(f.itemType)).map((f) => f.itemType),
    },
  ];

  for (const set of sets) {
    await CollectionSetDef.findOneAndUpdate(
      { setId: set.setId },
      {
        setId: set.setId,
        label: set.label,
        category: 'fish',
        emoji: set.emoji,
        description: set.description,
        sortOrder: set.sortOrder,
        itemTypes: set.itemTypes,
      },
      { upsert: true, returnDocument: 'after' },
    );
    log.info({ setId: set.setId, count: set.itemTypes.length }, 'Collection set upserted');
  }
}

async function main(): Promise<void> {
  const generateImages = process.argv.includes('--generate-images');

  if (!fs.existsSync(FISHES_TXT)) {
    log.fatal({ path: FISHES_TXT }, 'fishes.txt not found');
    process.exit(1);
  }

  const parsed = parseFishesTxt(fs.readFileSync(FISHES_TXT, 'utf8'));
  log.info({ count: parsed.length, generateImages }, 'Parsed fishes.txt');

  await connectDatabase();

  let created = 0;
  let updated = 0;
  for (const fish of parsed) {
    const result = await upsertFish(fish);
    if (result === 'created') created += 1;
    else updated += 1;
  }
  log.info({ created, updated }, 'Fish defs upserted');

  await seedCollectionSets(parsed);

  if (generateImages) {
    const needsArt = await GameItemDef.find({
      category: 'fish',
      itemType: { $in: parsed.map((f) => f.itemType) },
      $or: [{ imageUrl: { $exists: false } }, { imageUrl: null }, { imageUrl: '' }],
    }).select('itemType label');

    log.info({ count: needsArt.length }, 'Generating missing fish images');
    let ok = 0;
    let failed = 0;
    for (const item of needsArt) {
      try {
        const imageUrl = await generateFishImage(item.itemType, item.label);
        item.imageUrl = imageUrl;
        await item.save();
        ok += 1;
        log.info({ itemType: item.itemType, imageUrl }, 'Fish image saved');
        await sleep(1500);
      } catch (err) {
        failed += 1;
        log.error({ err, itemType: item.itemType }, 'Fish image generation failed');
      }
    }
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
