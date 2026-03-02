/**
 * Bakes the farm scenery layer into a single PNG image.
 * Run once as admin: npx tsx src/scripts/bakeScenery.ts
 * Output: uploads/scenery.png — served at GET /scenery
 */
import * as path from 'path';
import * as fs from 'fs';
import sharp from 'sharp';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { GameItemDef, type IGameItemDef } from '../models/GameItemDef.js';

const TILE_SIZE = 48;
const WORLD_PADDING = 12;
const FARM_COLS = 16;
const FARM_ROWS = 24;
const SCENERY_TREE_COLS = 4;
const SCENERY_TREE_ROWS = 5;
const SCENERY_TREE_SCALE_MIN = 1.1;
const SCENERY_TREE_SCALE_MAX = 1.5;
const TREE_ATTEMPTS = 300;
const TREE_PULL_IN = 2;
const BUSH_OFFSET_PX = 15;
const FARM_GRASS_COLOR = '#7EC87E';

function applyBushOffset(col: number, row: number, left: number, top: number, farmCols: number, farmRows: number): { left: number; top: number } {
  const fL = WORLD_PADDING, fT = WORLD_PADDING;
  const fR = WORLD_PADDING + farmCols - 1, fB = WORLD_PADDING + farmRows - 1;
  let l = left, t = top;
  if (row < fT) t -= BUSH_OFFSET_PX;
  if (row > fB) t += BUSH_OFFSET_PX;
  if (col < fL) l -= BUSH_OFFSET_PX;
  if (col > fR) l += BUSH_OFFSET_PX;
  return { left: l, top: t };
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Placement {
  itemType: string;
  worldCol: number;
  worldRow: number;
  cols: number;
  rows: number;
  scale?: number;
  zBoost?: number;
}

function generateSceneryPlacements(
  farmCols: number, farmRows: number, worldCols: number, worldRows: number,
  outerBushOccupied?: Set<string>,
): Placement[] {
  const rng = mulberry32(farmCols * 1000 + farmRows);
  const placements: Placement[] = [];
  const occupied = new Set<string>(outerBushOccupied ?? []);

  const isInFarm = (col: number, row: number, w: number, h: number) => {
    const fL = WORLD_PADDING, fT = WORLD_PADDING;
    const fR = WORLD_PADDING + farmCols, fB = WORLD_PADDING + farmRows;
    for (let dr = 0; dr < h; dr++)
      for (let dc = 0; dc < w; dc++) {
        const c = col + dc, r = row + dr;
        if (c >= fL - 1 && c <= fR && r >= fT - 1 && r <= fB) return true;
      }
    return false;
  };

  const fL = WORLD_PADDING, fT = WORLD_PADDING;
  const fR = WORLD_PADDING + farmCols, fB = WORLD_PADDING + farmRows;
  const treeInLeftTopZone = (col: number, row: number) => {
    if (col + SCENERY_TREE_COLS <= fL && col < fL - TREE_PULL_IN) return true;
    if (row + SCENERY_TREE_ROWS <= fT && row < fT - TREE_PULL_IN) return true;
    return false;
  };

  const treeTypes = ['scenery_tree_oak', 'scenery_tree_pine', 'scenery_tree_birch'];
  const treeW = SCENERY_TREE_COLS;
  const treeH = SCENERY_TREE_ROWS;
  const treeScaleRange = SCENERY_TREE_SCALE_MAX - SCENERY_TREE_SCALE_MIN;
  const inBounds = (col: number, row: number, w: number, h: number) =>
    col >= 0 && row >= 0 && col + w <= worldCols && row + h <= worldRows;

  const wouldOverlap = (col: number, row: number, w: number, h: number) => {
    for (let dr = 0; dr < h; dr++)
      for (let dc = 0; dc < w; dc++)
        if (occupied.has(`${col + dc},${row + dr}`)) return true;
    return false;
  };

  const treeOrigins = new Set<string>();
  for (let i = 0; i < TREE_ATTEMPTS; i++) {
    const col = Math.floor(rng() * worldCols);
    const row = Math.floor(rng() * worldRows);
    if (isInFarm(col, row, treeW, treeH) || !inBounds(col, row, treeW, treeH)) continue;
    if (treeInLeftTopZone(col, row)) continue;
    if (wouldOverlap(col, row, treeW, treeH)) continue;
    const originKey = `${col},${row}`;
    if (treeOrigins.has(originKey)) continue;
    treeOrigins.add(originKey);
    const scale = SCENERY_TREE_SCALE_MIN + rng() * treeScaleRange;
    placements.push({ itemType: treeTypes[Math.floor(rng() * treeTypes.length)], worldCol: col, worldRow: row, cols: treeW, rows: treeH, scale, zBoost: 1000 });
    for (let dr = 0; dr < treeH; dr++)
      for (let dc = 0; dc < treeW; dc++) occupied.add(`${col + dc},${row + dr}`);
  }

  return placements;
}

function generateOuterBushPlacements(
  farmCols: number, farmRows: number, worldCols: number, worldRows: number,
): { placements: Placement[]; occupied: Set<string> } {
  const rng = mulberry32(farmCols * 2000 + farmRows);
  const bushes: Placement[] = [];
  const fL = WORLD_PADDING, fT = WORLD_PADDING;
  const fR = WORLD_PADDING + farmCols - 1, fB = WORLD_PADDING + farmRows - 1;
  const scaleMin = 1.7, scaleMax = 2.2;

  const occupied = new Set<string>();
  const addBush = (col: number, row: number) => {
    if (col < 0 || col >= worldCols || row < 0 || row >= worldRows) return;
    const key = `${col},${row}`;
    if (occupied.has(key)) return;
    occupied.add(key);
    const scale = scaleMin + rng() * (scaleMax - scaleMin);
    bushes.push({ itemType: 'scenery_bush_large', worldCol: col, worldRow: row, cols: 1, rows: 1, scale, zBoost: 500 });
  };

  for (let c = fL - 2; c <= fR + 2; c++) {
    addBush(c, fT - 1);
    addBush(c, fT - 2);
    addBush(c, fB + 1);
    addBush(c, fB + 2);
  }
  for (let r = fT - 1; r <= fB + 1; r++) {
    addBush(fL - 1, r);
    addBush(fL - 2, r);
    addBush(fR + 1, r);
    addBush(fR + 2, r);
  }
  return { placements: bushes, occupied };
}

interface ResolvedPlacement {
  left: number;
  top: number;
  width: number;
  height: number;
  imageUrl: string;
  zIndex: number;
}

async function main() {
  await connectDatabase();

  const itemDefsList = await GameItemDef.find().lean();
  const itemDefs: Record<string, IGameItemDef> = {};
  for (const d of itemDefsList) {
    itemDefs[d.itemType] = d as IGameItemDef;
  }

  const worldCols = FARM_COLS + 2 * WORLD_PADDING;
  const worldRows = FARM_ROWS + 2 * WORLD_PADDING;

  const { placements: outerBushPlacements, occupied: outerBushOccupied } = generateOuterBushPlacements(FARM_COLS, FARM_ROWS, worldCols, worldRows);
  const sceneryPlacements = generateSceneryPlacements(FARM_COLS, FARM_ROWS, worldCols, worldRows, outerBushOccupied);
  const placements: Placement[] = [...outerBushPlacements, ...sceneryPlacements];

  const resolved: ResolvedPlacement[] = placements
    .map((p) => {
      const def = itemDefs[p.itemType];
      const imageUrl = def?.imageUrl;
      if (!imageUrl) return null;
      const s = p.scale ?? 1;
      const baseW = TILE_SIZE * p.cols;
      const baseH = TILE_SIZE * p.rows;
      const w = baseW * s;
      const h = baseH * s;
      const isTall = p.rows > 1;
      let left = p.worldCol * TILE_SIZE + (baseW - w) / 2;
      let top = isTall
        ? p.worldRow * TILE_SIZE + baseH - h
        : p.worldRow * TILE_SIZE + (baseH - h) / 2;
      if (p.cols === 1 && p.rows === 1) {
        const offset = applyBushOffset(p.worldCol, p.worldRow, left, top, FARM_COLS, FARM_ROWS);
        left = offset.left;
        top = offset.top;
      }
      const zIndex = p.worldRow + p.rows - 1 + (p.zBoost ?? 0);
      return {
        left,
        top,
        width: w,
        height: h,
        imageUrl,
        zIndex,
      };
    })
    .filter((r): r is ResolvedPlacement => r !== null);

  const sorted = resolved.sort((a, b) => a.zIndex - b.zIndex || a.left - b.left);

  const width = worldCols * TILE_SIZE;
  const height = worldRows * TILE_SIZE;

  const grassRgb = hexToRgb(FARM_GRASS_COLOR);
  const baseBuffer = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    baseBuffer[i * 4] = grassRgb.r;
    baseBuffer[i * 4 + 1] = grassRgb.g;
    baseBuffer[i * 4 + 2] = grassRgb.b;
    baseBuffer[i * 4 + 3] = 255;
  }

  const composites: { input: Buffer; left: number; top: number }[] = [];
  let fetched = 0;
  let skipped = 0;

  for (const p of sorted) {
    try {
      const res = await fetch(p.imageUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrBuf = await res.arrayBuffer();
      const buf = Buffer.from(arrBuf);
      const resized = await sharp(buf)
        .resize(Math.round(p.width), Math.round(p.height), { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .ensureAlpha()
        .png()
        .toBuffer();
      composites.push({
        input: resized,
        left: Math.round(p.left),
        top: Math.round(p.top),
      });
      fetched++;
      if (fetched % 100 === 0) process.stdout.write(`Fetched ${fetched}/${sorted.length}\r`);
    } catch (err) {
      skipped++;
      if (skipped <= 5) console.warn(`Skipped ${p.imageUrl}:`, err);
    }
  }

  console.log(`\nCompositing ${composites.length} images...`);

  const BATCH = 80;
  let img = sharp(baseBuffer, { raw: { width, height, channels: 4 } });

  for (let i = 0; i < composites.length; i += BATCH) {
    const batch = composites.slice(i, i + BATCH);
    const output = await img.composite(batch).png().toBuffer();
    img = sharp(output);
    process.stdout.write(`Composite ${Math.min(i + BATCH, composites.length)}/${composites.length}\r`);
  }

  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const outPath = path.join(uploadsDir, 'scenery.png');
  await img.png().toFile(outPath);

  console.log(`\nSaved ${outPath} (${width}x${height})`);
  await disconnectDatabase();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return { r: 126, g: 200, b: 126 };
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
