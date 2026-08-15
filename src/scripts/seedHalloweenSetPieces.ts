/**
 * Seed Halloween scene set pieces from hatchly-app-2026/items3.txt.
 *
 * Creates scenery / decoration / building / tiled_flooring defs with footprints
 * matching the scene editor, then fills missing art via OpenAI in parallel.
 *
 *   npm run seed:halloween-sets
 *   npm run seed:halloween-sets -- --generate-images --concurrency=10
 *   npm run seed:halloween-sets -- --generate-images --force-overlays
 */
import fs from 'node:fs';
import path from 'node:path';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { createLogger } from '../config/logger.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { openAIService } from '../services/OpenAIService.js';
import { storageService } from '../services/StorageService.js';

const log = createLogger('SeedHalloweenSets');

const ITEMS3_TXT = path.resolve(process.cwd(), '../hatchly-app-2026/items3.txt');

const STYLE_SPRITE =
  `Art style: flat vector illustration with thick uniform black outlines, ` +
  `soft cel-shaded coloring with one highlight and one shadow tone per surface, no gradients. ` +
  `Perspective: front-facing view, similar to stardew valley, centered in frame. ` +
  `Proportions: slightly chunky and rounded for a friendly, cute aesthetic. ` +
  `Lighting: soft diffused light from the upper left, no drop shadow. ` +
  `Transparent PNG background, no ground plane, no extra props or decorations. ` +
  `The asset should fill roughly 95% of the image. ` +
  `Cozy cute halloween farming-game set piece — spooky but friendly, muted plum, pumpkin orange, moss green and bone-cream, not gory, no blood, no text.`;

const STYLE_FLOORING_FILL =
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
  `furniture, characters, or strong one-way gradient. Avoid photo-realism, 3D bevels, text, and watermarks. ` +
  `Halloween haunted-forest palette: muted moss, rotten leaves, dark soil, soft orange and plum specks — cozy, not gory.`;

const STYLE_STRIP_H =
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
  `No furniture, characters, text, watermarks, photo-realism, or 3D bevels. ` +
  `Halloween haunted-forest palette: muted moss, rotten leaves, dark soil — cozy, not gory.`;

const STYLE_GROUND_OVERLAY =
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
  `No furniture, characters, text, watermarks, photo-realism, or 3D bevels. ` +
  `Halloween haunted-forest palette: muted moss, rotten leaves, dark soil, soft orange and plum specks — cozy, not gory.`;

type Category = 'scenery' | 'decoration' | 'building' | 'tiled_flooring';
type FloorKind = 'floor_fill' | 'strip_h';

interface SetPiece {
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
}

const SECTION_META: Record<string, { emoji: string; color: string; category: Category }> = {
  'Ground Cover': { emoji: '🌱', color: '#4A5D3A', category: 'scenery' },
  'Rocks & Natural Features': { emoji: '🪨', color: '#6E6A62', category: 'scenery' },
  Mushrooms: { emoji: '🍄', color: '#8B3A3A', category: 'scenery' },
  Plants: { emoji: '🌾', color: '#5C6B3A', category: 'scenery' },
  'Logs & Stumps': { emoji: '🪵', color: '#6B4A32', category: 'scenery' },
  'Graveyard Pieces': { emoji: '🪦', color: '#7A7A72', category: 'scenery' },
  Props: { emoji: '🕯', color: '#C45C26', category: 'decoration' },
  'Haunted Decorations': { emoji: '👻', color: '#9B8EC4', category: 'decoration' },
  'Spider Area': { emoji: '🕸', color: '#4A3A4A', category: 'scenery' },
  'Witch Area': { emoji: '🧙', color: '#6B4C8A', category: 'decoration' },
  Structures: { emoji: '🌉', color: '#6B5344', category: 'scenery' },
  'Atmosphere Pieces': { emoji: '🌫', color: '#8A9BB5', category: 'scenery' },
  'Bone Area': { emoji: '🦴', color: '#E8D9C0', category: 'scenery' },
  'Harvest Area': { emoji: '🎃', color: '#D4781E', category: 'decoration' },
  'Rare Set Pieces': { emoji: '✨', color: '#5A3D7A', category: 'building' },
  'Ground Tile Palette': { emoji: '🧩', color: '#3D4A32', category: 'tiled_flooring' },
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseItems3(contents: string): SetPiece[] {
  const lines = contents.split(/\r?\n/);
  let section = '';
  const seen = new Set<string>();
  const out: SetPiece[] = [];
  let sort = 8000;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('For the biome') || line.startsWith('These should')) continue;

    const header = line.replace(/^\p{Extended_Pictographic}+\s*/u, '').trim();
    if (SECTION_META[header]) {
      section = header;
      continue;
    }
    if (!section) continue;

    const label = header;
    if (!label) continue;

    const meta = SECTION_META[section];
    const category = categoryFor(label, section, meta.category);
    const size = sizeFor(label, section, category);
    const overlay = isPartialGroundStamp(label, section, category);
    const floor = overlay ? 'ground_overlay' : floorKindFor(label, category);
    const itemType = `${category}_${slugify(label)}`;
    if (seen.has(itemType)) continue;
    seen.add(itemType);

    out.push({
      label,
      itemType,
      section,
      category,
      subCategory: floor,
      cols: size.cols,
      rows: size.rows,
      centerOverflow: shouldOverflow(label, category),
      emoji: meta.emoji,
      color: meta.color,
      sortOrder: sort++,
    });
  }
  return out;
}

function categoryFor(label: string, section: string, fallback: Category): Category {
  const l = label.toLowerCase();
  if (section === 'Ground Tile Palette') {
    if (/fog overlay/.test(l)) return 'scenery';
    return 'tiled_flooring';
  }
  if (section === 'Rare Set Pieces') {
    if (/train tracks/.test(l)) return 'tiled_flooring';
    return 'building';
  }
  if (
    /cottage|mausoleum|gazebo|watchtower|cabin ruins|church|clock tower|windmill|castle|manor|treehouse/.test(l)
  ) {
    return 'building';
  }
  return fallback;
}

function floorKindFor(label: string, category: Category): string | undefined {
  if (category !== 'tiled_flooring') return undefined;
  const l = label.toLowerCase();
  if (/\bpath\b|train tracks/.test(l)) return 'strip_h';
  return 'floor_fill';
}

/** Patches, carpets, piles, fog — stamps that should feather into the floor under them. */
function isPartialGroundStamp(label: string, section: string, category: Category): boolean {
  if (category === 'tiled_flooring') return false;
  const l = label.toLowerCase();
  if (section === 'Ground Cover') return true;
  if (/fog overlay/.test(l)) return true;
  if (section === 'Atmosphere Pieces') {
    return /fog|mist|embers|falling leaves|floating ash|moonlight|fireflies/.test(l);
  }
  if (/poison mushroom patch|spider lily patch|^giant spider web$/.test(l)) return true;
  return false;
}

function shouldOverflow(label: string, category: Category): boolean {
  if (category === 'tiled_flooring') return false;
  const l = label.toLowerCase();
  if (category === 'building') return true;
  return (
    /tree|tower|post|hanging|lantern|ghost|spirit|mist|fog|fireflies|embers|ash|moonlight|ivy|reeds|totem|scarecrow|well|shrine|monolith|obelisk|windmill|cottage|stump|mushroom|portal|nest|web covered tree|owl|raven|crow|bat|floating/.test(
      l,
    )
  );
}

function sizeFor(label: string, section: string, category: Category): { cols: number; rows: number } {
  const l = label.toLowerCase();

  if (section === 'Ground Tile Palette') {
    if (/\bpath\b/.test(l)) return { cols: 6, rows: 2 };
    if (/fog overlay/.test(l)) return { cols: 3, rows: 3 };
    return { cols: 5, rows: 5 };
  }

  if (section === 'Rare Set Pieces') {
    if (/train tracks/.test(l)) return { cols: 6, rows: 2 };
    if (/skeleton dragon/.test(l)) return { cols: 8, rows: 4 };
    if (/world tree|pumpkin castle|forgotten cemetery/.test(l)) return { cols: 6, rows: 6 };
    if (/clock tower|treehouse/.test(l)) return { cols: 4, rows: 6 };
    if (/windmill|church|spider queen/.test(l)) return { cols: 5, rows: 5 };
    if (/manor gates/.test(l)) return { cols: 6, rows: 4 };
    if (/obelisk/.test(l)) return { cols: 2, rows: 5 };
    if (/eclipse monolith/.test(l)) return { cols: 3, rows: 5 };
    return { cols: 5, rows: 5 };
  }

  if (/family mausoleum|witch cottage|haunted gazebo|small cabin/.test(l)) return { cols: 4, rows: 4 };
  if (/fallen watchtower/.test(l)) return { cols: 3, rows: 4 };
  if (/destroyed wagon|pumpkin wagon|harvest cart|pumpkin wheelbarrow/.test(l)) return { cols: 3, rows: 2 };
  if (/broken wooden bridge|rotten bridge/.test(l)) return { cols: 5, rows: 2 };
  if (/abandoned campsite/.test(l)) return { cols: 4, rows: 3 };
  if (/spider den|spider tunnel|giant spider nest/.test(l)) return { cols: 4, rows: 3 };
  if (/web covered tree/.test(l)) return { cols: 3, rows: 3 };
  if (/cemetery gate|haunted archway|ruined stone arch|bone archway|wooden gate/.test(l)) {
    return { cols: 3, rows: 2 };
  }
  if (/stone circle|bone circle|fairy mushroom ring|rune circle|spell circle|candle circle|ancient ritual/.test(l)) {
    return { cols: 4, rows: 4 };
  }
  if (/giant boulder|giant mushroom|giant stump|giant pumpkin|giant rib|giant skull|giant spider web/.test(l)) {
    return { cols: 3, rows: 3 };
  }
  if (/ancient monolith|fallen monolith|standing stone|bone throne|witch's? windmill/.test(l)) {
    return { cols: 2, rows: 3 };
  }
  if (
    /boulder|stump|hollow log|fallen log|rotten log|broken log|tombstone|gravestone|grave marker|stone coffin|open grave|cauldron|bookshelf|spell table|crystal ball|wheelbarrow|crate|cart|wagon|hay bale|corn stalk|scarecrow|well|shrine| tent|campfire|pumpkin patch|pumpkin stack/.test(
      l,
    )
  ) {
    if (/\blog\b/.test(l)) return { cols: 3, rows: 1 };
    if (/pumpkin patch|hay bale|corn stalk/.test(l)) return { cols: 3, rows: 2 };
    if (/cauldron|bookshelf|spell table|crystal ball pedestal/.test(l)) return { cols: 2, rows: 2 };
    if (/well|shrine/.test(l)) return { cols: 2, rows: 2 };
    if (/scarecrow/.test(l)) return { cols: 2, rows: 2 };
    if (/tombstone|gravestone|grave marker|grave candle/.test(l)) return { cols: 1, rows: 1 };
    if (/stone coffin|open grave|fresh grave/.test(l)) return { cols: 2, rows: 1 };
    if (/stump/.test(l)) return { cols: 2, rows: 2 };
    if (/boulder/.test(l)) return { cols: 2, rows: 2 };
    return { cols: 2, rows: 2 };
  }
  if (/\bfence\b|\bgate\b/.test(l) && !/spider/.test(l)) return { cols: 1, rows: 1 };
  if (/lantern post|bone torch|raven perch|crow perch|owl perch|broom rack/.test(l)) return { cols: 1, rows: 2 };
  if (/hanging ivy|hanging lantern|hanging spider/.test(l)) return { cols: 1, rows: 2 };
  if (/ghost family|skeleton display|bone totem|creepy scarecrow|haunted doll/.test(l)) return { cols: 2, rows: 2 };
  if (/ghost portal|haunted mirror|spider nest|egg sac|witch garden|herb garden/.test(l)) return { cols: 3, rows: 3 };
  if (/fog|mist|moonlight|fireflies|embers|ash|falling leaves|bat swarm|raven flock/.test(l)) {
    return { cols: 2, rows: 2 };
  }
  if (/ground cover|patch|pile|cluster|carpet|tile/.test(l) && section === 'Ground Cover') {
    return { cols: 2, rows: 2 };
  }
  if (/mushroom cluster|mushroom patch|mushroom ring/.test(l)) return { cols: 2, rows: 2 };
  if (/twisted roots|exposed tree roots|root stump/.test(l)) return { cols: 2, rows: 2 };
  if (/tall dead grass|swamp reeds/.test(l)) return { cols: 1, rows: 2 };

  return { cols: 1, rows: 1 };
}

function imagePromptFor(piece: SetPiece): string {
  const name = piece.label.toLowerCase();
  if (piece.subCategory === 'ground_overlay') {
    return (
      `Irregular transparent overlay stamp of ${name} that blends into the ground underneath ` +
      `in a cozy top-down farming game. ${STYLE_GROUND_OVERLAY}`
    );
  }
  if (piece.category === 'tiled_flooring') {
    if (piece.subCategory === 'strip_h') {
      return (
        `Horizontally tileable transparent strip of ${name} for a cozy top-down farming game ` +
        `(repeat side-by-side for any length). ${STYLE_STRIP_H}`
      );
    }
    return `Seamless tileable floor texture of ${name} for a cozy top-down farming game. ${STYLE_FLOORING_FILL}`;
  }
  const kind =
    piece.category === 'building'
      ? 'landmark building'
      : piece.category === 'scenery'
        ? 'outdoor scenery prop'
        : 'placeable decoration';
  return `A single ${name} ${kind}, 2D game sprite for a cozy top-down farming game. ${STYLE_SPRITE}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function generateArt(piece: SetPiece): Promise<string> {
  const prompt = imagePromptFor(piece);
  const opaque = piece.category === 'tiled_flooring' && piece.subCategory === 'floor_fill';
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

async function upsertPiece(piece: SetPiece): Promise<void> {
  const $set: Record<string, unknown> = {
    label: piece.label,
    emoji: piece.emoji,
    color: piece.color,
    category: piece.category,
    placeable: true,
    cols: piece.cols,
    rows: piece.rows,
    centerOverflow: piece.centerOverflow,
    sellable: false,
    buyable: false,
    sortOrder: piece.sortOrder,
  };
  if (piece.subCategory) $set.subCategory = piece.subCategory;

  const update: Record<string, unknown> = {
    $set,
    $setOnInsert: {
      itemType: piece.itemType,
      harvestYield: [],
      autoConnect: false,
      gemPrice: 0,
    },
  };
  if (!piece.subCategory) update.$unset = { subCategory: 1 };

  await GameItemDef.findOneAndUpdate({ itemType: piece.itemType }, update, { upsert: true });
}

async function main(): Promise<void> {
  const generateImages = process.argv.includes('--generate-images');
  const forceOverlays = process.argv.includes('--force-overlays');
  const concurrencyArg = process.argv.find((a) => a.startsWith('--concurrency='));
  const concurrency = Math.max(1, Math.min(16, Number(concurrencyArg?.split('=')[1] ?? 10) || 10));

  if (!fs.existsSync(ITEMS3_TXT)) {
    throw new Error(`Missing items3.txt at ${ITEMS3_TXT}`);
  }

  const pieces = parseItems3(fs.readFileSync(ITEMS3_TXT, 'utf8'));
  const bySection = new Map<string, number>();
  for (const p of pieces) bySection.set(p.section, (bySection.get(p.section) ?? 0) + 1);
  log.info({ count: pieces.length, sections: Object.fromEntries(bySection), generateImages, forceOverlays, concurrency }, 'Parsed items3 set pieces');

  await connectDatabase();

  for (const piece of pieces) {
    await upsertPiece(piece);
  }
  log.info({ upserted: pieces.length }, 'Item defs upserted');

  if (generateImages) {
    const overlayTypes = pieces.filter((p) => p.subCategory === 'ground_overlay').map((p) => p.itemType);
    const needsArt = forceOverlays
      ? await GameItemDef.find({ itemType: { $in: overlayTypes } }).select('itemType label imageUrl')
      : await GameItemDef.find({
          itemType: { $in: pieces.map((p) => p.itemType) },
          $or: [{ imageUrl: { $exists: false } }, { imageUrl: null }, { imageUrl: '' }],
        }).select('itemType label');

    const byType = new Map(pieces.map((p) => [p.itemType, p]));
    log.info(
      { count: needsArt.length, concurrency, forceOverlays, overlayCount: overlayTypes.length },
      'Generating set-piece images',
    );

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
          item.imageUrl = imageUrl;
          await item.save();
          ok += 1;
          log.info(
            {
              itemType: item.itemType,
              cols: piece.cols,
              rows: piece.rows,
              category: piece.category,
              imageUrl,
              done: ok,
              left: needsArt.length - ok - failed,
            },
            'Set-piece image saved',
          );
        } catch (err) {
          failed += 1;
          log.error({ err, itemType: item.itemType }, 'Set-piece image failed');
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, needsArt.length)) }, () => worker()));
    log.info({ ok, failed, remaining: needsArt.length - ok }, 'Image generation finished');
  }

  await disconnectDatabase();
  log.info('Halloween set-piece seed complete');
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
