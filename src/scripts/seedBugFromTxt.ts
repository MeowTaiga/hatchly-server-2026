/**
 * Parse hatchly-app-2026/bugs.txt and upsert bug GameItemDefs + CollectionSetDefs.
 *
 * Locations are collapsed into 7 habitats (like fish spots → 5):
 *   flower · forest · grass · pond · rock · haunt · open
 *
 * Time column maps onto bugActiveTime; bare "Rain" (and Rain+*) sets bugWeather.
 *
 * Usage:
 *   npm run seed:bugs
 *   npm run seed:bugs -- --generate-images
 *   npm run seed:bugs -- --generate-images --concurrency=6
 *
 * Upserts by itemType (preserves existing imageUrl). Optional --generate-images
 * fills missing art via OpenAI in parallel (default concurrency 6).
 */
import fs from 'node:fs';
import path from 'node:path';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { createLogger } from '../config/logger.js';
import { GameItemDef, type BugActiveTime, type BugRarity } from '../models/GameItemDef.js';
import { CollectionSetDef } from '../models/CollectionSetDef.js';
import { openAIService } from '../services/OpenAIService.js';
import { storageService } from '../services/StorageService.js';

const log = createLogger('SeedBugs');

/** Same front-facing style as admin bug / default item image gen. */
const STYLE_FRAGMENT =
  `Art style: flat vector illustration with thick uniform black outlines, ` +
  `soft cel-shaded coloring with one highlight and one shadow tone per surface, no gradients. ` +
  `Perspective: front-facing view, similar to stardew valley, centered in frame. ` +
  `Proportions: slightly chunky and rounded for a friendly, cute aesthetic. ` +
  `Lighting: soft diffused light from the upper left, no drop shadow. ` +
  `Transparent PNG background, no ground plane, no extra props or decorations. ` +
  `The asset should fill roughly 95% of the image.`;

const BUGS_TXT = path.resolve(process.cwd(), '../hatchly-app-2026/bugs.txt');

/** Map txt names onto existing DB slugs when they differ. */
const ITEM_TYPE_ALIASES: Record<string, string> = {
  grasshopper: 'grass_hopper',
  pill_bug: 'rollypolly',
  green_caterpillar: 'caterpillar',
};

/** Coarse museum / spawn habitats (trimmed from the long location list). */
export type BugHabitat =
  | 'flower'
  | 'forest'
  | 'grass'
  | 'pond'
  | 'rock'
  | 'haunt'
  | 'open';

type TxtRarity = 'common' | 'rare' | 'unique' | 'legendary' | 'mythic';

interface ParsedBug {
  itemType: string;
  label: string;
  rarity: TxtRarity;
  habitat: BugHabitat;
  /** Host keys for bugSpawnOn (empty = anywhere). */
  spawnOn: string[];
  activeTime: BugActiveTime;
  /** When 'rain', only spawns during rain weather. */
  weather?: 'rain';
  collectionTags: string[];
  isEvent: boolean;
}

const SELL_RANGES: Record<TxtRarity, [number, number]> = {
  common: [8, 25],
  rare: [30, 55],
  unique: [120, 450],
  legendary: [500, 1800],
  mythic: [2000, 15000],
};

const SIZE_RANGES: Record<TxtRarity, [number, number]> = {
  common: [0.4, 1.2],
  rare: [0.5, 1.5],
  unique: [0.8, 2.0],
  legendary: [1.2, 3.0],
  mythic: [2.0, 5.0],
};

const RARITY_EMOJI: Record<TxtRarity, string> = {
  common: '🐛',
  rare: '💎',
  unique: '⭐',
  legendary: '👑',
  mythic: '🌌',
};

const RARITY_COLOR: Record<TxtRarity, string> = {
  common: '#84CC16',
  rare: '#38BDF8',
  unique: '#A78BFA',
  legendary: '#F59E0B',
  mythic: '#F472B6',
};

const HABITAT_META: Record<
  BugHabitat,
  { setId: string; label: string; emoji: string; description: string; sortOrder: number }
> = {
  flower: {
    setId: 'bug_flower',
    label: 'Flower',
    emoji: '🌸',
    description: 'Meadows, gardens, and flower fields.',
    sortOrder: 1,
  },
  forest: {
    setId: 'bug_forest',
    label: 'Forest',
    emoji: '🌳',
    description: 'Woods, trees, and leafy canopies.',
    sortOrder: 2,
  },
  grass: {
    setId: 'bug_grass',
    label: 'Grass',
    emoji: '🌾',
    description: 'Grasslands, dirt, and crop patches.',
    sortOrder: 3,
  },
  pond: {
    setId: 'bug_pond',
    label: 'Pond',
    emoji: '💧',
    description: 'Ponds, marshes, swamps, and still water.',
    sortOrder: 4,
  },
  rock: {
    setId: 'bug_rock',
    label: 'Rock',
    emoji: '🪨',
    description: 'Rocks, caves, and ancient stone.',
    sortOrder: 5,
  },
  haunt: {
    setId: 'bug_haunt',
    label: 'Haunt',
    emoji: '⛩️',
    description: 'Shrines, graveyards, and sacred grounds.',
    sortOrder: 6,
  },
  open: {
    setId: 'bug_open',
    label: 'Open farm',
    emoji: '🌿',
    description: 'Wanderers that turn up almost anywhere.',
    sortOrder: 7,
  },
};

/** Themed sets from the Collections section of bugs.txt (label → member labels). */
const THEMED_SETS: Array<{
  setId: string;
  label: string;
  emoji: string;
  description: string;
  sortOrder: number;
  members: string[];
}> = [
  {
    setId: 'bug_meadow_set',
    label: 'Meadow',
    emoji: '🌼',
    description: 'Butterflies and meadow hoppers.',
    sortOrder: 10,
    members: [
      'Butterfly',
      'Monarch Butterfly',
      'Blue Morpho Butterfly',
      'Grasshopper',
      'Cricket',
      'Praying Mantis',
      'Ghost Butterfly',
    ],
  },
  {
    setId: 'bug_garden_set',
    label: 'Garden',
    emoji: '🌸',
    description: 'Garden pollinators and petal guests.',
    sortOrder: 11,
    members: [
      'Ladybug',
      'Honey Bee',
      'Bumblebee',
      'Orchid Mantis',
      'Bloom Bee',
      'Pumpkin Ladybug',
    ],
  },
  {
    setId: 'bug_forest_set',
    label: 'Forest shelf',
    emoji: '🌲',
    description: 'Deep-woods beetles and moths.',
    sortOrder: 12,
    members: [
      'Stag Beetle',
      'Stick Bug',
      'Walking Leaf',
      'Luna Moth',
      'Atlas Moth',
      'Aurora Moth',
      'Titan Mantis',
    ],
  },
  {
    setId: 'bug_pond_set',
    label: 'Pond shelf',
    emoji: '🏞️',
    description: 'Skimmers and dragonflies of still water.',
    sortOrder: 13,
    members: [
      'Dragonfly',
      'Damselfly',
      'Water Strider',
      'Giant Dragonfly',
      'Celestial Dragonfly',
      'Infinity Dragonfly',
    ],
  },
  {
    setId: 'bug_night_set',
    label: 'Night',
    emoji: '🌙',
    description: 'Glowbugs of the dark hours.',
    sortOrder: 14,
    members: [
      'Firefly',
      'Glow Firefly',
      'Dream Firefly',
      'Haunted Firefly',
      'Astral Firefly',
      'Cosmic Firefly',
    ],
  },
  {
    setId: 'bug_spider_set',
    label: 'Spider',
    emoji: '🕷️',
    description: 'Web-weavers and cave crawlers.',
    sortOrder: 15,
    members: [
      'Orb Weaver Spider',
      'Wolf Spider',
      'Crystal Spider',
      'Spirit Spider',
      'Nebula Spider',
      'Dream Weaver Spider',
      'Spider Queen',
    ],
  },
  {
    setId: 'bug_royal_set',
    label: 'Royal',
    emoji: '👑',
    description: 'Crown jewels of the bug kingdom.',
    sortOrder: 16,
    members: [
      'Royal Scarab',
      'Crown Beetle',
      'Rainbow Emperor Butterfly',
      'Moon Emperor Moth',
      'Celest Bee',
    ],
  },
  {
    setId: 'bug_celestial_set',
    label: 'Celestial',
    emoji: '✨',
    description: 'Starlit and cosmic legendaries.',
    sortOrder: 17,
    members: [
      'Galactic Butterfly',
      'Phoenix Dragonfly',
      'Cosmic Firefly',
      'Stardust Butterfly',
      'Worldtree Beetle',
      'Ethereal Scarab',
    ],
  },
  {
    setId: 'bug_haunted_set',
    label: 'Haunted',
    emoji: '🎃',
    description: 'Autumn-exclusive spooky critters.',
    sortOrder: 18,
    members: [
      'Ghost Butterfly',
      'Phantom Moth',
      'Skeleton Beetle',
      'Bone Spider',
      'Soul Firefly',
      'Grim Scarab',
      'Haunted Orb Weaver',
      'Ghost Leaf Bug',
    ],
  },
];

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

function mapLocation(location: string): { habitat: BugHabitat; spawnOn: string[] } {
  const l = location.toLowerCase().trim();

  if (l === 'everywhere' || l === 'town') {
    return { habitat: 'open', spawnOn: [] };
  }
  if (
    l.includes('pond') ||
    l.includes('marsh') ||
    l.includes('swamp') ||
    l.includes('lake')
  ) {
    // Water bugs wander the farm (no water host yet).
    return { habitat: 'pond', spawnOn: [] };
  }
  if (
    l.includes('rock') ||
    l.includes('cave') ||
    l.includes('ruin') ||
    l.includes('temple') ||
    l.includes('desert')
  ) {
    return { habitat: 'rock', spawnOn: ['rock'] };
  }
  if (l.includes('cemetery') || l.includes('graveyard') || l.includes('shrine')) {
    return { habitat: 'haunt', spawnOn: [] };
  }
  if (l.includes('forest') || l.includes('tree') || l.includes('world tree')) {
    return { habitat: 'forest', spawnOn: ['forest'] };
  }
  if (l.includes('grass') || l.includes('dirt') || l.includes('pumpkin')) {
    return { habitat: 'grass', spawnOn: ['grass'] };
  }
  if (
    l.includes('flower') ||
    l.includes('meadow') ||
    l.includes('garden') ||
    l.includes('valley')
  ) {
    return { habitat: 'flower', spawnOn: ['flower'] };
  }
  return { habitat: 'open', spawnOn: [] };
}

function mapTimeAndWeather(raw: string): { activeTime: BugActiveTime; weather?: 'rain' } {
  const t = raw.toLowerCase().trim();
  const weather: 'rain' | undefined = /\brain\b/.test(t) ? 'rain' : undefined;

  // Pure weather rows (e.g. "Rain", "Fog") → all day + optional rain gate.
  if (/^(rain|fog|foggy morning)$/i.test(t.trim()) || t === 'rain') {
    return { activeTime: 'all_day', weather };
  }

  if (/\b(midnight|night|full moon|meteor shower|eclipse)\b/.test(t)) {
    return { activeTime: 'night', weather };
  }
  if (/\b(morning|dawn|sunrise)\b/.test(t)) {
    return { activeTime: 'morning', weather };
  }
  if (/\b(evening|sunset|dusk|day|noon|summer|spring|random)\b/.test(t)) {
    return { activeTime: 'afternoon', weather };
  }
  if (weather) return { activeTime: 'all_day', weather };
  return { activeTime: 'all_day' };
}

function parseBugsTxt(contents: string): ParsedBug[] {
  const lines = contents.split(/\r?\n/);
  let section: TxtRarity | 'autumn' | null = null;
  const byType = new Map<string, ParsedBug>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^🦋\s*Common/i.test(line)) {
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
    if (
      /^🗺️\s*Bug Locations/i.test(line) ||
      /^📖\s*Collections/i.test(line) ||
      /^🏆\s*Completion/i.test(line)
    ) {
      section = null;
      continue;
    }
    if (/^Only catchable/i.test(line)) continue;
    if (!section) continue;
    if (/^Bug\tLocation\tTime$/i.test(line)) continue;
    if (!line.includes('\t')) continue;

    const parts = line.split('\t').map((p) => p.trim());
    if (parts.length < 3) continue;
    const [label, location, time] = parts;
    if (!label || label === 'Bug') continue;

    const itemType = resolveItemType(label);
    const isEvent = section === 'autumn';
    const rarity: TxtRarity = isEvent ? 'unique' : section;
    const { habitat, spawnOn } = mapLocation(location);
    const { activeTime, weather } = mapTimeAndWeather(time);
    const collectionTags = isEvent ? ['haunted'] : [];

    const existing = byType.get(itemType);
    if (existing) {
      if (isEvent && !existing.collectionTags.includes('haunted')) {
        existing.collectionTags.push('haunted');
      }
      continue;
    }

    byType.set(itemType, {
      itemType,
      label,
      rarity,
      habitat,
      spawnOn,
      activeTime,
      weather,
      collectionTags,
      isEvent,
    });
  }

  return Array.from(byType.values());
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function generateBugImage(itemType: string, label: string): Promise<string> {
  const prompt =
    `A single ${label.toLowerCase()}, 2D game sprite for a cozy top-down farming game. ${STYLE_FRAGMENT}`;
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

async function upsertBug(bug: ParsedBug): Promise<'created' | 'updated'> {
  const existing = await GameItemDef.findOne({ itemType: bug.itemType });
  const [sizeMin, sizeMax] = SIZE_RANGES[bug.rarity];
  const sellPrice = sellPriceFor(bug.itemType, bug.rarity);
  const payload = {
    label: bug.label,
    emoji: bug.isEvent ? '🎃' : RARITY_EMOJI[bug.rarity],
    color: RARITY_COLOR[bug.rarity],
    category: 'bug' as const,
    placeable: false,
    cols: 1,
    rows: 1,
    sellable: true,
    sellPrice,
    bugRarity: bug.rarity as BugRarity,
    bugActiveTime: bug.activeTime,
    bugSpawnOn: bug.spawnOn.length ? bug.spawnOn : undefined,
    bugWeather: bug.weather,
    bugSizeMin: sizeMin,
    bugSizeMax: sizeMax,
    bugCollectionTags: bug.collectionTags.length ? bug.collectionTags : undefined,
  };

  if (!existing) {
    await GameItemDef.create({ itemType: bug.itemType, ...payload });
    return 'created';
  }

  existing.label = payload.label;
  existing.emoji = payload.emoji;
  existing.color = payload.color;
  existing.category = 'bug';
  existing.placeable = false;
  existing.sellable = true;
  existing.sellPrice = sellPrice;
  existing.bugRarity = payload.bugRarity;
  existing.bugActiveTime = payload.bugActiveTime;
  existing.bugSpawnOn = payload.bugSpawnOn;
  existing.bugWeather = payload.bugWeather;
  existing.bugSizeMin = sizeMin;
  existing.bugSizeMax = sizeMax;
  existing.bugCollectionTags = payload.bugCollectionTags;
  await existing.save();
  return 'updated';
}

async function seedCollectionSets(bugs: ParsedBug[]): Promise<void> {
  const nonEvent = bugs.filter((b) => !b.isEvent);
  const byHabitat = (habitat: BugHabitat) =>
    nonEvent.filter((b) => b.habitat === habitat).map((b) => b.itemType);

  const haunted = bugs
    .filter((b) => b.collectionTags.includes('haunted'))
    .map((b) => b.itemType);

  // Habitat shelves (7)
  for (const habitat of Object.keys(HABITAT_META) as BugHabitat[]) {
    const meta = HABITAT_META[habitat];
    const itemTypes = byHabitat(habitat);
    if (itemTypes.length === 0) {
      log.info({ setId: meta.setId }, 'Skipping empty habitat set');
      continue;
    }
    await CollectionSetDef.findOneAndUpdate(
      { setId: meta.setId },
      {
        setId: meta.setId,
        label: meta.label,
        category: 'bug',
        emoji: meta.emoji,
        description: meta.description,
        sortOrder: meta.sortOrder,
        itemTypes,
      },
      { upsert: true, returnDocument: 'after' },
    );
    log.info({ setId: meta.setId, count: itemTypes.length }, 'Habitat set upserted');
  }

  // Themed shelves from Collections section
  const labelToType = new Map(bugs.map((b) => [b.label.toLowerCase(), b.itemType]));
  for (const set of THEMED_SETS) {
    const itemTypes = set.members
      .map((name) => labelToType.get(name.toLowerCase()) ?? resolveItemType(name))
      .filter((t, i, arr) => arr.indexOf(t) === i);

    // Prefer members that actually exist in the parse
    const known = itemTypes.filter((t) => bugs.some((b) => b.itemType === t));
    if (known.length === 0) {
      log.info({ setId: set.setId }, 'Skipping empty themed set');
      continue;
    }

    await CollectionSetDef.findOneAndUpdate(
      { setId: set.setId },
      {
        setId: set.setId,
        label: set.label,
        category: 'bug',
        emoji: set.emoji,
        description: set.description,
        sortOrder: set.sortOrder,
        itemTypes: known,
      },
      { upsert: true, returnDocument: 'after' },
    );
    log.info({ setId: set.setId, count: known.length }, 'Themed set upserted');
  }

  // Ensure haunted set includes every autumn-tagged bug (in case list drifts)
  if (haunted.length > 0) {
    await CollectionSetDef.findOneAndUpdate(
      { setId: 'bug_haunted_set' },
      {
        $set: {
          setId: 'bug_haunted_set',
          label: 'Haunted',
          category: 'bug',
          emoji: '🎃',
          description: 'Autumn-exclusive spooky critters.',
          sortOrder: 18,
          itemTypes: haunted,
        },
      },
      { upsert: true },
    );
  }

  // Drop legacy habitat set ids from the earlier spawn-only seed if present
  await CollectionSetDef.deleteMany({
    setId: { $in: ['bug_crop', 'bug_tree', 'bug_light', 'bug_anywhere'] },
  });
}

async function main(): Promise<void> {
  const generateImages = process.argv.includes('--generate-images');
  const concurrencyArg = process.argv.find((a) => a.startsWith('--concurrency='));
  const concurrency = Math.max(
    1,
    Math.min(12, Number(concurrencyArg?.split('=')[1] ?? 6) || 6),
  );

  if (!fs.existsSync(BUGS_TXT)) {
    log.fatal({ path: BUGS_TXT }, 'bugs.txt not found');
    process.exit(1);
  }

  const parsed = parseBugsTxt(fs.readFileSync(BUGS_TXT, 'utf8'));
  const rainCount = parsed.filter((b) => b.weather === 'rain').length;
  const byHabitat = Object.fromEntries(
    (Object.keys(HABITAT_META) as BugHabitat[]).map((h) => [
      h,
      parsed.filter((b) => b.habitat === h).length,
    ]),
  );
  log.info({ count: parsed.length, rainCount, byHabitat, generateImages, concurrency }, 'Parsed bugs.txt');

  await connectDatabase();

  let created = 0;
  let updated = 0;
  for (const bug of parsed) {
    const result = await upsertBug(bug);
    if (result === 'created') created += 1;
    else updated += 1;
  }
  log.info({ created, updated }, 'Bug defs upserted');

  await seedCollectionSets(parsed);

  if (generateImages) {
    const needsArt = await GameItemDef.find({
      category: 'bug',
      itemType: { $in: parsed.map((b) => b.itemType) },
      $or: [{ imageUrl: { $exists: false } }, { imageUrl: null }, { imageUrl: '' }],
    }).select('itemType label');

    log.info({ count: needsArt.length, concurrency }, 'Generating missing bug images');
    let ok = 0;
    let failed = 0;
    let cursor = 0;

    async function worker(): Promise<void> {
      while (cursor < needsArt.length) {
        const index = cursor;
        cursor += 1;
        const item = needsArt[index];
        try {
          const imageUrl = await generateBugImage(item.itemType, item.label);
          item.imageUrl = imageUrl;
          await item.save();
          ok += 1;
          log.info(
            { itemType: item.itemType, imageUrl, done: ok, left: needsArt.length - ok - failed },
            'Bug image saved',
          );
        } catch (err) {
          failed += 1;
          log.error({ err, itemType: item.itemType }, 'Bug image generation failed');
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, needsArt.length) }, () => worker()),
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
