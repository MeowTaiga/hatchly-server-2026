/**
 * Parse hatchly-app-2026/crafting.txt, items.txt, and items2.txt and upsert:
 * - result GameItemDefs (furniture decorations / equip tools / processed mats)
 * - crafting GameRecipes
 * - recipe scroll items (shared crafting_recipe art)
 *
 * Usage:
 *   npm run seed:crafting
 *   npm run seed:crafting -- --generate-images
 *   npm run seed:crafting-images
 *   npm run seed:crafting-images -- --concurrency=6
 *
 * Upserts by itemType (preserves existing imageUrl). Optional --generate-images
 * fills missing art via OpenAI in parallel (default concurrency 5).
 */
import fs from 'node:fs';
import path from 'node:path';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { createLogger } from '../config/logger.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { Recipe } from '../models/Recipe.js';
import { openAIService } from '../services/OpenAIService.js';
import { storageService } from '../services/StorageService.js';
import {
  defaultRecipeItemType,
  ensureCraftingRecipeItemDef,
} from '../services/CraftingRecipeItems.js';
import { STARTER_CRAFTING_RECIPE_IDS } from '../constants/starterCraftingRecipes.js';
import { craftItemSize } from '../constants/craftItemSize.js';

const log = createLogger('SeedCrafting');

const CRAFTING_TXT = path.resolve(process.cwd(), '../hatchly-app-2026/crafting.txt');
const ITEMS_TXT = path.resolve(process.cwd(), '../hatchly-app-2026/items.txt');
const ITEMS2_TXT = path.resolve(process.cwd(), '../hatchly-app-2026/items2.txt');

const STYLE_FRAGMENT =
  `Art style: flat vector illustration with thick uniform black outlines, ` +
  `soft cel-shaded coloring with one highlight and one shadow tone per surface, no gradients. ` +
  `Perspective: front-facing view, similar to stardew valley, centered in frame. ` +
  `Proportions: slightly chunky and rounded for a friendly, cute aesthetic. ` +
  `Lighting: soft diffused light from the upper left, no drop shadow. ` +
  `Transparent PNG background, no ground plane, no extra props or decorations. ` +
  `The asset should fill roughly 95% of the image.`;

type CraftSection = 'stone' | 'primitive' | 'stick' | 'tools' | 'material' | 'furniture';

interface ParsedIngredient {
  itemType: string;
  qty: number;
}

interface ParsedCraftRow {
  section: CraftSection;
  label: string;
  itemType: string;
  recipeId: string;
  ingredients: ParsedIngredient[];
  difficulty: number;
  sortOrder: number;
  group?: string;
}

const MATERIAL_ALIASES: Record<string, string> = {
  stone: 'stone',
  stones: 'stone',
  stick: 'stick',
  sticks: 'stick',
  wood: 'wood',
  woods: 'wood',
  plank: 'wooden_plank',
  planks: 'wooden_plank',
  'wooden plank': 'wooden_plank',
  'wooden planks': 'wooden_plank',
  iron: 'iron',
  irons: 'iron',
  'iron ingot': 'iron',
  'iron ingots': 'iron',
  'iron ore': 'iron_ore',
  cloth: 'cloth',
  fabric: 'cloth',
  glass: 'glass',
  rope: 'rope',
  crystal: 'crystal',
  crystals: 'crystal',
  scrap: 'scrap',
  'candy corn': 'candy_corn',
  candy_corn: 'candy_corn',
};

/** Processed material results that should reuse existing itemTypes / recipeIds. */
const RESULT_ALIASES: Record<string, { itemType: string; recipeId: string }> = {
  plank: { itemType: 'wooden_plank', recipeId: 'wood_plank' },
  wooden_plank: { itemType: 'wooden_plank', recipeId: 'wood_plank' },
};

const SECTION_META: Record<
  CraftSection,
  { emoji: string; color: string; baseSort: number }
> = {
  stone: { emoji: '🪨', color: '#9E9E9E', baseSort: 100 },
  primitive: { emoji: '🪵', color: '#8D6E63', baseSort: 200 },
  stick: { emoji: '🪵', color: '#A1887F', baseSort: 300 },
  tools: { emoji: '🔧', color: '#78909C', baseSort: 400 },
  material: { emoji: '📦', color: '#A1887F', baseSort: 50 },
  furniture: { emoji: '🪑', color: '#8D6E63', baseSort: 500 },
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseIngredients(recipeCell: string): ParsedIngredient[] {
  const parts = recipeCell.split(',').map((p) => p.trim()).filter(Boolean);
  const out: ParsedIngredient[] = [];
  for (const part of parts) {
    const m = part.match(/^(\d+)\s+(.+)$/i);
    if (!m) {
      throw new Error(`Bad ingredient cell: "${part}"`);
    }
    const qty = Number(m[1]);
    const materialName = m[2].trim().toLowerCase();
    const itemType = MATERIAL_ALIASES[materialName];
    if (!itemType) {
      throw new Error(`Unknown material "${m[2]}" in "${recipeCell}"`);
    }
    if (!Number.isFinite(qty) || qty < 1) {
      throw new Error(`Bad qty in "${part}"`);
    }
    out.push({ itemType, qty });
  }
  if (out.length < 1 || out.length > 4) {
    throw new Error(`Recipes need 1-4 ingredients: "${recipeCell}"`);
  }
  return out;
}

function detectSection(label: string, ingredients: ParsedIngredient[]): CraftSection {
  const isTool = /fishing\s*pole|\bnet\b|axe|pickaxe|shovel/i.test(label);
  if (isTool) return 'tools';

  const mats = new Set(ingredients.map((i) => i.itemType));
  if (mats.has('stick') && mats.has('stone')) return 'primitive';
  if (mats.has('stick') && !mats.has('stone')) return 'stick';
  return 'stone';
}

function parseDifficulty(cell: string | undefined, ingredients: ParsedIngredient[]): number {
  if (cell) {
    const n = Number(cell);
    if (Number.isInteger(n) && n >= 1 && n <= 5) return n;
  }
  return difficultyFromIngredients(ingredients);
}

function difficultyFromIngredients(ingredients: ParsedIngredient[]): number {
  const total = ingredients.reduce((sum, i) => sum + i.qty, 0);
  if (total <= 8) return 1;
  if (total <= 16) return 2;
  if (total <= 28) return 3;
  if (total <= 40) return 4;
  return 5;
}

function resolveResultIds(label: string): { itemType: string; recipeId: string } {
  const slug = slugify(label);
  return RESULT_ALIASES[slug] ?? { itemType: slug, recipeId: slug };
}

function parseTableRows(
  contents: string,
  opts: { defaultSection?: CraftSection; seen: Set<string>; sortCounter: { n: number } },
): ParsedCraftRow[] {
  const rows: ParsedCraftRow[] = [];
  let group: string | undefined;
  let inProcessedMaterials = false;

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const header = line.match(/^#+\s+(.+)$/);
    if (header) {
      const title = header[1].replace(/[^\w\s-]/g, '').trim();
      group = slugify(title);
      inProcessedMaterials = /processed/i.test(header[1]);
      continue;
    }
    if (/^processed\b/i.test(line) && !line.startsWith('|')) {
      inProcessedMaterials = true;
      continue;
    }
    if (/^gathered\b/i.test(line) && !line.startsWith('|')) {
      inProcessedMaterials = false;
      continue;
    }

    if (!line.startsWith('|')) continue;
    if (/^\|\s*-+/.test(line)) continue;

    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cells.length < 2) continue;

    const [itemCell, recipeCell, difficultyCell] = cells;
    if (/^item$/i.test(itemCell) || /^recipe$/i.test(recipeCell) || /^source$/i.test(recipeCell)) {
      continue;
    }
    if (!/^\d+\s+/.test(recipeCell)) continue;

    const label = itemCell.replace(/\s+/g, ' ').trim();
    const ingredients = parseIngredients(recipeCell);
    const { itemType, recipeId } = resolveResultIds(label);

    if (opts.seen.has(itemType) || opts.seen.has(recipeId)) {
      log.warn({ itemType, recipeId, label }, 'Duplicate craft row skipped');
      continue;
    }
    opts.seen.add(itemType);
    opts.seen.add(recipeId);
    opts.sortCounter.n += 1;

    const section: CraftSection = inProcessedMaterials || RESULT_ALIASES[slugify(label)]
      ? 'material'
      : (opts.defaultSection ?? detectSection(label, ingredients));

    rows.push({
      section,
      label,
      itemType,
      recipeId,
      ingredients,
      difficulty: parseDifficulty(difficultyCell, ingredients),
      sortOrder: SECTION_META[section].baseSort + opts.sortCounter.n,
      group,
    });
  }

  return rows;
}

function parseCraftingTxt(contents: string, seen: Set<string>, sortCounter: { n: number }): ParsedCraftRow[] {
  return parseTableRows(contents, { seen, sortCounter });
}

function parseItemsTxt(contents: string, seen: Set<string>, sortCounter: { n: number }): ParsedCraftRow[] {
  return parseTableRows(contents, { defaultSection: 'furniture', seen, sortCounter });
}

function toolSubCategory(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('fishing')) return 'fishing_poles';
  if (/\bnet\b/.test(l)) return 'net';
  if (l.includes('pickaxe')) return 'pickaxe';
  if (l.includes('axe')) return 'axe';
  if (l.includes('shovel')) return 'shovel';
  return 'pickaxe';
}

function sizeFor(label: string, section: CraftSection): { cols: number; rows: number } {
  return craftItemSize(label, section);
}

function sellPriceFor(row: ParsedCraftRow): number {
  const unitCost: Record<string, number> = {
    stone: 8,
    stick: 4,
    wood: 6,
    wooden_plank: 10,
    iron_ore: 12,
    iron: 20,
    cloth: 8,
    glass: 14,
    rope: 6,
    crystal: 30,
    scrap: 5,
  };
  const materialCost = row.ingredients.reduce((sum, i) => {
    return sum + i.qty * (unitCost[i.itemType] ?? 6);
  }, 0);
  return Math.max(5, Math.round(materialCost * 0.75));
}

function materialHint(row: ParsedCraftRow): string {
  const mats = row.ingredients.map((i) => i.itemType);
  if (row.section === 'material') return 'a stack of crafted building material';
  if (mats.includes('crystal')) return 'made with glowing crystals and fine furnishings';
  if (mats.includes('iron') && mats.includes('scrap')) return 'riveted from iron and scrap metal';
  if (mats.includes('cloth') && mats.includes('wooden_plank')) {
    return 'built from wooden planks with soft cloth upholstery';
  }
  if (mats.includes('wooden_plank')) return 'built from smooth wooden planks';
  if (mats.includes('stick') && mats.includes('stone')) {
    return 'made from rough wooden sticks and grey stone';
  }
  if (mats.includes('stone')) return 'carved from grey stone';
  if (mats.includes('stick')) return 'built from rough wooden sticks and branches';
  return 'handmade rustic farm craft';
}

function imagePromptFor(row: ParsedCraftRow): string {
  const material = materialHint(row);
  if (row.section === 'tools') {
    const kind = toolSubCategory(row.label).replace(/_/g, ' ');
    return (
      `A single handheld ${row.label.toLowerCase()} (${kind} tool), ` +
      `${material}, inventory/tool icon for a cozy top-down farming game. ` +
      `Show the complete tool diagonally, head upper-right, handle lower-left. ` +
      `${STYLE_FRAGMENT}`
    );
  }
  return (
    `A single placeable ${row.label.toLowerCase()} decoration, ${material}, ` +
    `2D game sprite for a cozy top-down farming game. ${STYLE_FRAGMENT}`
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function generateCraftImage(row: ParsedCraftRow): Promise<string> {
  const prompt = imagePromptFor(row);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const base64DataUri = await openAIService.generateImageBase64(prompt, {
        model: 'gpt-image-1',
        size: '1024x1024',
        quality: 'medium',
        background: 'transparent',
      });
      return await storageService.uploadBase64(base64DataUri, `game-items/${row.itemType}`);
    } catch (err) {
      lastErr = err;
      log.warn({ err, itemType: row.itemType, attempt }, 'Image generation failed; retrying');
      await sleep(2000 * attempt);
    }
  }
  throw lastErr;
}

async function upsertResultItem(row: ParsedCraftRow): Promise<void> {
  const meta = SECTION_META[row.section];
  const size = sizeFor(row.label, row.section);
  const isTool = row.section === 'tools';
  const isMaterial = row.section === 'material';
  const isWorkbench = /workbench|crafting table/i.test(row.label);
  const sellPrice = sellPriceFor(row);

  const $set: Record<string, unknown> = {
    label: row.label,
    emoji: meta.emoji,
    color: meta.color,
    category: isTool ? 'equip' : isMaterial ? 'material' : 'decoration',
    placeable: !isTool && !isMaterial,
    cols: size.cols,
    rows: size.rows,
    sellable: true,
    sellPrice,
    buyable: isMaterial,
    sortOrder: row.sortOrder,
  };

  if (isTool) {
    $set.subCategory = toolSubCategory(row.label);
  } else if (isWorkbench) {
    $set.interactAction = { type: 'open_modal', payload: 'crafting' };
  }

  const update: Record<string, unknown> = {
    $set,
    $setOnInsert: {
      itemType: row.itemType,
      harvestYield: [],
      autoConnect: false,
      gemPrice: isMaterial ? sellPrice : 0,
    },
  };

  // Decorations should not keep a leftover tool subCategory from older seeds.
  if (!isTool) {
    update.$unset = { subCategory: 1 };
  }

  await GameItemDef.findOneAndUpdate({ itemType: row.itemType }, update, { upsert: true });
}

async function upsertRecipe(row: ParsedCraftRow): Promise<void> {
  const recipeItemType = defaultRecipeItemType(row.recipeId);
  await Recipe.findOneAndUpdate(
    { recipeId: row.recipeId },
    {
      $set: {
        label: row.label,
        resultItemType: row.itemType,
        resultQty: 1,
        ingredients: row.ingredients,
        difficulty: row.difficulty,
        recipeType: 'crafting',
        recipeItemType,
        group: row.group,
        sortOrder: row.sortOrder,
      },
      $setOnInsert: {
        recipeId: row.recipeId,
      },
    },
    { upsert: true },
  );

  await ensureCraftingRecipeItemDef({
    recipeId: row.recipeId,
    label: row.label,
    recipeItemType,
  });
}

async function main(): Promise<void> {
  const generateImages = process.argv.includes('--generate-images');

  if (!fs.existsSync(CRAFTING_TXT)) {
    throw new Error(`Missing crafting.txt at ${CRAFTING_TXT}`);
  }

  const seen = new Set<string>();
  const sortCounter = { n: 0 };
  const primitiveRows = parseCraftingTxt(fs.readFileSync(CRAFTING_TXT, 'utf8'), seen, sortCounter);
  const themedRows = fs.existsSync(ITEMS_TXT)
    ? parseItemsTxt(fs.readFileSync(ITEMS_TXT, 'utf8'), seen, sortCounter)
    : [];
  const clutterRows = fs.existsSync(ITEMS2_TXT)
    ? parseItemsTxt(fs.readFileSync(ITEMS2_TXT, 'utf8'), seen, sortCounter)
    : [];
  const allRows = [...primitiveRows, ...themedRows, ...clutterRows];
  const onlyArg = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
  const rows =
    onlyArg === 'items2'
      ? clutterRows
      : onlyArg === 'items'
        ? themedRows
        : allRows;
  log.info(
    {
      primitive: primitiveRows.length,
      themed: themedRows.length,
      clutter: clutterRows.length,
      seeding: rows.length,
      only: onlyArg ?? 'all',
      craftingTxt: CRAFTING_TXT,
      itemsTxt: ITEMS_TXT,
      items2Txt: ITEMS2_TXT,
      generateImages,
    },
    'Parsed crafting catalogs',
  );

  await connectDatabase();

  let items = 0;
  let recipes = 0;
  let tools = 0;
  for (const row of rows) {
    await upsertResultItem(row);
    items += 1;
    if (row.section === 'tools') tools += 1;
    await upsertRecipe(row);
    recipes += 1;
    log.info(
      {
        recipeId: row.recipeId,
        section: row.section,
        category: row.section === 'tools' ? 'equip' : 'decoration',
        subCategory: row.section === 'tools' ? toolSubCategory(row.label) : undefined,
        ingredients: row.ingredients,
        starter: (STARTER_CRAFTING_RECIPE_IDS as readonly string[]).includes(row.recipeId),
      },
      row.label,
    );
  }

  if (generateImages) {
    const concurrencyArg = process.argv.find((a) => a.startsWith('--concurrency='));
    const concurrency = Math.max(
      1,
      Math.min(12, Number(concurrencyArg?.split('=')[1] ?? 5) || 5),
    );
    const byType = new Map(rows.map((r) => [r.itemType, r]));
    const needsArt = await GameItemDef.find({
      itemType: { $in: rows.map((r) => r.itemType) },
      $or: [{ imageUrl: { $exists: false } }, { imageUrl: null }, { imageUrl: '' }],
    }).select('itemType label');

    log.info({ count: needsArt.length, concurrency }, 'Generating missing crafting item images');
    let ok = 0;
    let failed = 0;
    let cursor = 0;

    async function worker(): Promise<void> {
      while (cursor < needsArt.length) {
        const index = cursor;
        cursor += 1;
        const item = needsArt[index];
        const row = byType.get(item.itemType);
        if (!row) continue;
        try {
          const imageUrl = await generateCraftImage(row);
          item.imageUrl = imageUrl;
          await item.save();
          ok += 1;
          log.info(
            { itemType: item.itemType, section: row.section, imageUrl, done: ok, left: needsArt.length - ok - failed },
            'Craft image saved',
          );
        } catch (err) {
          failed += 1;
          log.error({ err, itemType: item.itemType }, 'Craft image generation failed');
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, needsArt.length) }, () => worker()));
    log.info({ ok, failed }, 'Image generation finished');
  }

  const starterPresent = STARTER_CRAFTING_RECIPE_IDS.filter((id) =>
    rows.some((r) => r.recipeId === id),
  );
  const starterMissing = STARTER_CRAFTING_RECIPE_IDS.filter(
    (id) => !starterPresent.includes(id),
  );

  await disconnectDatabase();
  log.info(
    { items, recipes, tools, starterPresent, starterMissing },
    'Crafting seed complete',
  );
  if (starterMissing.length) {
    console.warn('WARNING: starter recipes missing from crafting.txt:', starterMissing);
  }
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
