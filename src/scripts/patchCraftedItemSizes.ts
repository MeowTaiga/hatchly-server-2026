/**
 * Recompute cols/rows for crafted furniture from items.txt + items2.txt
 * and write them onto GameItemDef.
 *
 *   npx tsx src/scripts/patchCraftedItemSizes.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { craftItemSize } from '../constants/craftItemSize.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('PatchCraftSizes');

const ITEMS_TXT = path.resolve(process.cwd(), '../hatchly-app-2026/items.txt');
const ITEMS2_TXT = path.resolve(process.cwd(), '../hatchly-app-2026/items2.txt');

const RESULT_ALIASES: Record<string, string> = {
  plank: 'wooden_plank',
  wooden_plank: 'wooden_plank',
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseLabels(contents: string): { label: string; itemType: string; section: 'material' | 'furniture' }[] {
  const out: { label: string; itemType: string; section: 'material' | 'furniture' }[] = [];
  const seen = new Set<string>();
  let inProcessedMaterials = false;

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const header = line.match(/^#+\s+(.+)$/);
    if (header) {
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

    if (!line.startsWith('|') || /^\|\s*-+/.test(line)) continue;
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cells.length < 2) continue;
    const [itemCell, recipeCell] = cells;
    if (/^item$/i.test(itemCell) || /^recipe$/i.test(recipeCell) || /^source$/i.test(recipeCell)) {
      continue;
    }
    if (!/^\d+\s+/.test(recipeCell)) continue;

    const label = itemCell.replace(/\s+/g, ' ').trim();
    const slug = slugify(label);
    const itemType = RESULT_ALIASES[slug] ?? slug;
    if (seen.has(itemType)) continue;
    seen.add(itemType);

    const section = inProcessedMaterials || RESULT_ALIASES[slug] ? 'material' : 'furniture';
    out.push({ label, itemType, section });
  }
  return out;
}

async function main(): Promise<void> {
  const rows = [
    ...parseLabels(fs.readFileSync(ITEMS_TXT, 'utf8')),
    ...parseLabels(fs.readFileSync(ITEMS2_TXT, 'utf8')),
  ];

  await connectDatabase();

  const counts: Record<string, number> = {
    '1x1': 0,
    '2x1': 0,
    '2x2': 0,
    '3x2': 0,
    '3x3': 0,
    '4x3': 0,
    '4x4': 0,
    '5x5': 0,
    '6x5': 0,
    other: 0,
    missing: 0,
    unchanged: 0,
    updated: 0,
  };

  for (const row of rows) {
    const size = craftItemSize(row.label, row.section);
    const key = `${size.cols}x${size.rows}`;
    if (key in counts) counts[key] += 1;
    else counts.other += 1;

    const existing = await GameItemDef.findOne({ itemType: row.itemType }).select('cols rows label');
    if (!existing) {
      counts.missing += 1;
      log.warn({ itemType: row.itemType, label: row.label, size }, 'No GameItemDef');
      continue;
    }
    if (existing.cols === size.cols && existing.rows === size.rows) {
      counts.unchanged += 1;
      continue;
    }
    const from = `${existing.cols}x${existing.rows}`;
    existing.cols = size.cols;
    existing.rows = size.rows;
    await existing.save();
    counts.updated += 1;
    log.info({ itemType: row.itemType, from, to: key, label: row.label }, 'Sized');
  }

  await disconnectDatabase();
  log.info({ total: rows.length, ...counts }, 'Crafted item size patch complete');
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
