/**
 * Seed mining materials, cave set pieces, smelter, and smelting recipes
 * from hatchly-app-2026/mineing.txt.
 *
 *   npm run seed:mining
 *   npm run seed:mining -- --generate-images --concurrency=8
 */
import fs from 'node:fs';
import path from 'node:path';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { createLogger } from '../config/logger.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { openAIService } from '../services/OpenAIService.js';
import { storageService } from '../services/StorageService.js';
import { ensureSmeltingRecipes } from '../services/SmeltingService.js';
import {
  INGOT_ITEM_TYPES,
  MINING_ORE_DEFS,
} from '../constants/miningOres.js';

const log = createLogger('SeedMining');

const MINING_TXT = path.resolve(process.cwd(), '../hatchly-app-2026/mineing.txt');

const STYLE_SPRITE =
  `Art style: flat vector illustration with thick uniform black outlines, ` +
  `soft cel-shaded coloring with one highlight and one shadow tone per surface, no gradients. ` +
  `Perspective: front-facing view, similar to stardew valley, centered in frame. ` +
  `Proportions: slightly chunky and rounded for a friendly, cute aesthetic. ` +
  `Lighting: warm lantern light from the upper left, no drop shadow. ` +
  `Transparent PNG background, no ground plane, no extra props. ` +
  `The asset should fill roughly 95% of the image. ` +
  `Cozy cute mining-cave farming-game set piece — stone, moss, amber lantern glow, not scary, no text.`;

const STYLE_ITEM =
  `A single inventory item icon, 2D game sprite for a cozy farming game. ` +
  `Flat vector, thick black outlines, cute chunky proportions, centered, transparent PNG, no text, no ground. ` +
  `Soft lantern lighting. Fill ~90% of the frame.`;

const STYLE_FLOORING_FILL =
  `This is a repeating GAME GROUND TEXTURE, not a prop. ` +
  `Cozy stylized 2D farming-game floor (Stardew Valley feel), flat hand-painted color, ` +
  `strict orthographic top-down, even lighting, square 1:1, 100% opaque edge-to-edge. ` +
  `CRITICAL — SEAMLESS WRAP: left continues into right, top into bottom. ` +
  `Cave / mine palette: cool stone, gravel, moss specks, faint crystal glitter — cozy, not gory.`;

const STYLE_GROUND_OVERLAY =
  `This is a GROUND DECAL / OVERLAY STAMP for a top-down farming game. ` +
  `Transparent PNG, irregular organic patch, feathered alpha edges, no hard square. ` +
  `Do NOT paint a full dirt background. Cave palette: moss, gravel, crystals, puddles.`;

type Category = 'scenery' | 'decoration' | 'building' | 'tiled_flooring' | 'material';

interface Piece {
  label: string;
  itemType: string;
  section: string;
  category: Category;
  subCategory?: string;
  cols: number;
  rows: number;
  centerOverflow: boolean;
  emoji: string;
  color: string;
  sortOrder: number;
  promptKind: 'sprite' | 'item' | 'floor' | 'overlay' | 'smelter';
}

const SECTION_META: Record<string, { emoji: string; color: string; category: Category }> = {
  'Cave Walls & Floors': { emoji: '🪨', color: '#6E6A62', category: 'scenery' },
  'Cave Openings': { emoji: '🕳️', color: '#4A4540', category: 'scenery' },
  'Mine Structures': { emoji: '⛏️', color: '#6B5344', category: 'scenery' },
  'Mining Clutter': { emoji: '🪵', color: '#8B6914', category: 'decoration' },
  'Ore Deposits': { emoji: '💎', color: '#B87333', category: 'scenery' },
  'Underground Environment': { emoji: '💧', color: '#4A7A8A', category: 'scenery' },
  'Cave Flora': { emoji: '🍄', color: '#3A6B4A', category: 'scenery' },
  'Cave Wildlife Props': { emoji: '🦇', color: '#4A3A4A', category: 'scenery' },
  'Ancient Cave Ruins': { emoji: '🏺', color: '#8A7A5A', category: 'decoration' },
  'Deep Cave / Magical Set Pieces': { emoji: '✨', color: '#5A3D7A', category: 'building' },
  'Big Landmark Set Pieces': { emoji: '🚂', color: '#5A4A3A', category: 'building' },
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseSetPieces(contents: string): Piece[] {
  const lines = contents.split(/\r?\n/);
  let section = '';
  const seen = new Set<string>();
  const out: Piece[] = [];
  let sort = 9000;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const header = line.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D]+\s*/u, '').trim();
    if (SECTION_META[header]) {
      section = header;
      continue;
    }
    if (!section) continue;
    if (line.startsWith('And I') || line.startsWith("I'd") || line.startsWith('These ')) continue;

    const label = header;
    if (!label || /^(Material|Rarity|Main Uses|Vibe)\b/.test(label)) continue;
    if (label.includes('\t') && /Common|Rare|Uncommon/.test(label)) continue;

    const meta = SECTION_META[section];
    const category = categoryFor(label, section, meta.category);
    const itemType = `${category}_${slugify(label)}`;
    if (seen.has(itemType)) continue;
    seen.add(itemType);

    const size = sizeFor(label, section, category);
    out.push({
      label,
      itemType,
      section,
      category,
      subCategory: subCategoryFor(label, section, category),
      cols: size.cols,
      rows: size.rows,
      centerOverflow: shouldOverflow(label, category),
      emoji: meta.emoji,
      color: meta.color,
      sortOrder: sort++,
      promptKind: promptKindFor(label, section, category),
    });
  }
  return out;
}

function categoryFor(label: string, section: string, fallback: Category): Category {
  const l = label.toLowerCase();
  if (/floor|ceiling/.test(l) && /cave|rocky|cracked|muddy|gravel|deep|crystal|ancient|wet/.test(l)) {
    if (/dripping|wet cave floor/.test(l)) return 'scenery';
    if (section === 'Cave Walls & Floors' && /floor/.test(l) && !/wet/.test(l)) return 'tiled_flooring';
  }
  if (section === 'Big Landmark Set Pieces' || section === 'Deep Cave / Magical Set Pieces') {
    return 'building';
  }
  if (/elevator|workshop|storage shed|temple|cathedral|station|town/.test(l)) return 'building';
  return fallback;
}

function subCategoryFor(label: string, section: string, category: Category): string | undefined {
  if (category === 'tiled_flooring') return 'floor_fill';
  const l = label.toLowerCase();
  if (section === 'Cave Flora' && /moss patch|cave grass|mushroom circle/.test(l)) return 'ground_overlay';
  if (/cave puddle|wet cave floor|gravel/.test(l)) return 'ground_overlay';
  return undefined;
}

function promptKindFor(label: string, _section: string, category: Category): Piece['promptKind'] {
  if (category === 'tiled_flooring') return 'floor';
  if (label.toLowerCase().includes('smelter')) return 'smelter';
  return 'sprite';
}

function shouldOverflow(label: string, category: Category): boolean {
  if (category === 'tiled_flooring') return false;
  const l = label.toLowerCase();
  if (category === 'building') return true;
  return /pillar|entrance|support|lantern|hanging|mushroom|crystal|statue|arch|tree|elevator|gate|waterfall/.test(l);
}

function sizeFor(label: string, section: string, category: Category): { cols: number; rows: number } {
  const l = label.toLowerCase();
  if (category === 'tiled_flooring') return { cols: 5, rows: 5 };
  if (section === 'Big Landmark Set Pieces') {
    if (/cathedral|temple|town|cavern|chamber/.test(l)) return { cols: 6, rows: 6 };
    if (/elevator|shaft|station|waterfall/.test(l)) return { cols: 4, rows: 5 };
    return { cols: 5, rows: 5 };
  }
  if (section === 'Deep Cave / Magical Set Pieces') {
    if (/forest|grove|garden|cavern|lake|island|rift/.test(l)) return { cols: 5, rows: 5 };
    return { cols: 4, rows: 4 };
  }
  if (/large cave entrance|crystal cave entrance|ancient ruin|underground lake/.test(l)) return { cols: 4, rows: 3 };
  if (/mine shaft|elevator|workshop|storage shed/.test(l)) return { cols: 3, rows: 3 };
  if (/giant /.test(l)) return { cols: 3, rows: 3 };
  if (/bridge|track|passage|tunnel/.test(l)) return { cols: 4, rows: 2 };
  if (/deposit/.test(l)) return { cols: 2, rows: 2 };
  if (/pillar|support|rack|lantern|winch|pulley/.test(l)) return { cols: 1, rows: 2 };
  if (/wall/.test(l)) return { cols: 2, rows: 2 };
  if (/crate|barrel|bucket|cart|chest|campfire|bedroll|backpack/.test(l)) return { cols: 1, rows: 1 };
  return { cols: 2, rows: 2 };
}

function materialPieces(): Piece[] {
  const out: Piece[] = [];
  let sort = 8500;
  for (const ore of MINING_ORE_DEFS) {
    out.push({
      label: ore.label,
      itemType: ore.dropItemType,
      section: 'Materials',
      category: 'material',
      subCategory:
        ore.dropItemType === 'stone'
          ? 'ground_pickup'
          : ore.dropItemType.endsWith('_ore') || ore.id === 'coal'
            ? 'ore'
            : ore.rarity === 'common'
              ? 'stone'
              : 'gem',
      cols: 1,
      rows: 1,
      centerOverflow: false,
      emoji: ore.emoji,
      color: ore.color,
      sortOrder: sort++,
      promptKind: 'item',
    });
  }
  const ingotMeta: Record<string, { label: string; color: string; emoji: string }> = {
    copper_ingot: { label: 'Copper Ingot', color: '#B87333', emoji: '🟧' },
    tin_ingot: { label: 'Tin Ingot', color: '#A8B4B8', emoji: '⬜' },
    bronze_ingot: { label: 'Bronze Ingot', color: '#CD7F32', emoji: '🟤' },
    iron_ingot: { label: 'Iron Ingot', color: '#7A5C45', emoji: '⬛' },
    steel_ingot: { label: 'Steel Ingot', color: '#6B7A86', emoji: '⚙️' },
    silver_ingot: { label: 'Silver Ingot', color: '#C0C0C0', emoji: '🥈' },
    gold_ingot: { label: 'Gold Ingot', color: '#D4AF37', emoji: '🥇' },
    brass_ingot: { label: 'Brass Ingot', color: '#B5A642', emoji: '🟨' },
  };
  for (const itemType of INGOT_ITEM_TYPES) {
    const meta = ingotMeta[itemType];
    out.push({
      label: meta.label,
      itemType,
      section: 'Ingots',
      category: 'material',
      subCategory: 'ingot',
      cols: 1,
      rows: 1,
      centerOverflow: false,
      emoji: meta.emoji,
      color: meta.color,
      sortOrder: sort++,
      promptKind: 'item',
    });
  }
  out.push({
    label: 'Smelter',
    itemType: 'smelter',
    section: 'Buildings',
    category: 'building',
    cols: 2,
    rows: 2,
    centerOverflow: true,
    emoji: '🔥',
    color: '#C45C26',
    sortOrder: sort++,
    promptKind: 'smelter',
  });
  out.push({
    label: 'Slag',
    itemType: 'slag',
    section: 'Materials',
    category: 'material',
    subCategory: 'slag',
    cols: 1,
    rows: 1,
    centerOverflow: false,
    emoji: '🪨',
    color: '#5A5348',
    sortOrder: sort++,
    promptKind: 'item',
  });
  return out;
}

function imagePromptFor(piece: Piece): string {
  const name = piece.label.toLowerCase();
  if (piece.promptKind === 'smelter') {
    return (
      `A cute stone-and-brick smelter furnace building with a glowing fire mouth, chimney, and bellows, ` +
      `2D game sprite for a cozy top-down farming game. ${STYLE_SPRITE}`
    );
  }
  if (piece.promptKind === 'item') {
    if (piece.subCategory === 'ingot') {
      return `A single cute metal ${name} bar, stacked slightly, shiny but not photo-real. ${STYLE_ITEM}`;
    }
    if (piece.subCategory === 'ore') {
      return `A single cute chunk of ${name} with visible crystals in rock, inventory icon. ${STYLE_ITEM}`;
    }
    if (piece.subCategory === 'gem') {
      return `A single cute faceted ${name} gem or crystal cluster, inventory icon. ${STYLE_ITEM}`;
    }
    return `A single cute ${name} resource chunk, inventory icon. ${STYLE_ITEM}`;
  }
  if (piece.promptKind === 'floor') {
    return `Seamless tileable cave floor texture of ${name} for a cozy top-down farming game. ${STYLE_FLOORING_FILL}`;
  }
  if (piece.subCategory === 'ground_overlay') {
    return `Irregular transparent overlay stamp of ${name}. ${STYLE_GROUND_OVERLAY}`;
  }
  const kind =
    piece.category === 'building' ? 'landmark building' : piece.category === 'scenery' ? 'cave scenery prop' : 'mine decoration';
  return `A single ${name} ${kind}, 2D game sprite for a cozy cave mining farming game. ${STYLE_SPRITE}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function generateArt(piece: Piece): Promise<string> {
  const prompt = imagePromptFor(piece);
  const opaque = piece.promptKind === 'floor';
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const base64DataUri = await openAIService.generateImageBase64(prompt, {
        model: 'gpt-image-1',
        size: '1024x1024',
        quality: opaque ? 'high' : 'medium',
        background: opaque ? 'opaque' : 'transparent',
      });
      return await storageService.uploadBase64(base64DataUri, `game-items/${piece.itemType}`);
    } catch (err) {
      lastErr = err;
      log.warn({ err, itemType: piece.itemType, attempt }, 'Image generation failed; retrying');
      await sleep(2000 * attempt);
    }
  }
  throw lastErr;
}

async function upsertPiece(piece: Piece): Promise<void> {
  const $set: Record<string, unknown> = {
    label: piece.label,
    emoji: piece.emoji,
    color: piece.color,
    category: piece.category,
    placeable: piece.category !== 'material',
    cols: piece.cols,
    rows: piece.rows,
    centerOverflow: piece.centerOverflow,
    sellable: piece.category === 'material',
    buyable: piece.itemType === 'smelter',
    sortOrder: piece.sortOrder,
  };
  if (piece.itemType === 'smelter') {
    $set.interactAction = { type: 'open_modal', payload: 'smelting' };
    $set.gemPrice = 120;
  }
  if (piece.subCategory) $set.subCategory = piece.subCategory;

  const update: Record<string, unknown> = {
    $set,
    $setOnInsert: {
      itemType: piece.itemType,
      harvestYield: [],
      autoConnect: false,
    },
  };
  if (!piece.subCategory) update.$unset = { subCategory: 1 };

  await GameItemDef.findOneAndUpdate({ itemType: piece.itemType }, update, { upsert: true });
}

async function main(): Promise<void> {
  const generateImages = process.argv.includes('--generate-images');
  const force = process.argv.includes('--force');
  const concurrencyArg = process.argv.find((a) => a.startsWith('--concurrency='));
  const concurrency = Math.max(1, Math.min(16, Number(concurrencyArg?.split('=')[1] ?? 8) || 8));

  if (!fs.existsSync(MINING_TXT)) {
    throw new Error(`Missing mineing.txt at ${MINING_TXT}`);
  }

  const setPieces = parseSetPieces(fs.readFileSync(MINING_TXT, 'utf8'));
  const materials = materialPieces();
  const pieces = [...materials, ...setPieces];
  const bySection = new Map<string, number>();
  for (const p of pieces) bySection.set(p.section, (bySection.get(p.section) ?? 0) + 1);
  log.info({ count: pieces.length, sections: Object.fromEntries(bySection), generateImages, concurrency }, 'Parsed mining content');

  await connectDatabase();

  for (const piece of pieces) {
    await upsertPiece(piece);
  }
  await ensureSmeltingRecipes();
  log.info({ upserted: pieces.length }, 'Item defs + smelting recipes upserted');

  if (generateImages) {
    const types = pieces.map((p) => p.itemType);
    const needsArt = force
      ? await GameItemDef.find({ itemType: { $in: types } }).select('itemType label imageUrl')
      : await GameItemDef.find({
          itemType: { $in: types },
          $or: [{ imageUrl: { $exists: false } }, { imageUrl: null }, { imageUrl: '' }],
        }).select('itemType label');

    const byType = new Map(pieces.map((p) => [p.itemType, p]));
    log.info({ count: needsArt.length, concurrency }, 'Generating mining images');

    let ok = 0;
    let failed = 0;
    let cursor = 0;

    async function worker(): Promise<void> {
      while (cursor < needsArt.length) {
        const index = cursor;
        cursor += 1;
        const item = needsArt[index];
        const piece = byType.get(item.itemType);
        if (!piece) continue;
        try {
          const imageUrl = await generateArt(piece);
          await GameItemDef.updateOne({ itemType: piece.itemType }, { $set: { imageUrl } });
          ok += 1;
          log.info({ itemType: piece.itemType, ok, failed, left: needsArt.length - ok - failed }, 'Art saved');
        } catch (err) {
          failed += 1;
          log.error({ err, itemType: piece.itemType }, 'Art failed');
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    log.info({ ok, failed }, 'Image generation finished');
  }

  await disconnectDatabase();
}

main().catch((err) => {
  log.fatal({ err }, 'seedMiningFromTxt failed');
  process.exit(1);
});
