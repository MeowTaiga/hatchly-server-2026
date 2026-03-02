import sharp from 'sharp';
import { GameItemDef, type IGameItemDef } from '../models/GameItemDef.js';
import { BakedScenery } from '../models/BakedScenery.js';
import type { IScene } from '../models/Scene.js';
import { storageService } from './StorageService.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('SceneryBakeService');

const TILE_SIZE = 48;
const WORLD_PADDING = 12;
const FARM_GRASS_COLOR = '#7EC87E';
const BAKE_SCALE = 2;

const SCENERY_TREE_COLS = 4;
const SCENERY_TREE_ROWS = 5;
/** ~20% smaller than previous for better proportion. */
const SCENERY_TREE_SCALE_MIN = 1.1;
const SCENERY_TREE_SCALE_MAX = 1.5;
const TREE_ATTEMPTS = 300;

// ─── PRNG (deterministic per farm size) ──────────────────────────────────────

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Placement Types ─────────────────────────────────────────────────────────

interface Placement {
  itemType: string;
  worldCol: number;
  worldRow: number;
  cols: number;
  rows: number;
  scale?: number;
}

interface ResolvedPlacement {
  left: number;
  top: number;
  width: number;
  height: number;
  imageUrl: string;
  depth: number;
  /** Rotation in degrees (0–360). Applied during composite. */
  rotationDegrees?: number;
}

// ─── Placement Generation ────────────────────────────────────────────────────

export interface SceneryOverrides {
  outerBushType?: string;
  treeTypes?: string[];
}

const DEFAULT_TREE_TYPES = ['scenery_tree_oak', 'scenery_tree_pine', 'scenery_tree_birch'];
const DEFAULT_OUTER_BUSH = 'scenery_bush_large';
const BUSH_OFFSET_PX = 15;

/** Push bush position 15px further from farm interior. */
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

function generateSceneryPlacements(
  farmCols: number, farmRows: number, worldCols: number, worldRows: number,
  overrides?: SceneryOverrides,
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

  const inBounds = (col: number, row: number, w: number, h: number) =>
    col >= 0 && row >= 0 && col + w <= worldCols && row + h <= worldRows;

  const markOccupied = (col: number, row: number, w: number, h: number) => {
    for (let dr = 0; dr < h; dr++)
      for (let dc = 0; dc < w; dc++) occupied.add(`${col + dc},${row + dr}`);
  };

  const wouldOverlap = (col: number, row: number, w: number, h: number) => {
    for (let dr = 0; dr < h; dr++)
      for (let dc = 0; dc < w; dc++)
        if (occupied.has(`${col + dc},${row + dr}`)) return true;
    return false;
  };

  const fL = WORLD_PADDING, fT = WORLD_PADDING;
  const fR = WORLD_PADDING + farmCols, fB = WORLD_PADDING + farmRows;
  const TREE_PULL_IN = 2;

  const treeInLeftTopZone = (col: number, row: number) => {
    if (col + SCENERY_TREE_COLS <= fL && col < fL - TREE_PULL_IN) return true;
    if (row + SCENERY_TREE_ROWS <= fT && row < fT - TREE_PULL_IN) return true;
    return false;
  };

  const treeTypes = overrides?.treeTypes?.length ? overrides.treeTypes : DEFAULT_TREE_TYPES;
  const treeScaleRange = SCENERY_TREE_SCALE_MAX - SCENERY_TREE_SCALE_MIN;
  const treeOrigins = new Set<string>();

  for (let i = 0; i < TREE_ATTEMPTS; i++) {
    const col = Math.floor(rng() * worldCols);
    const row = Math.floor(rng() * worldRows);
    if (isInFarm(col, row, SCENERY_TREE_COLS, SCENERY_TREE_ROWS) || !inBounds(col, row, SCENERY_TREE_COLS, SCENERY_TREE_ROWS)) continue;
    if (treeInLeftTopZone(col, row)) continue;
    if (wouldOverlap(col, row, SCENERY_TREE_COLS, SCENERY_TREE_ROWS)) continue;
    const originKey = `${col},${row}`;
    if (treeOrigins.has(originKey)) continue;
    treeOrigins.add(originKey);
    const scale = SCENERY_TREE_SCALE_MIN + rng() * treeScaleRange;
    placements.push({ itemType: treeTypes[Math.floor(rng() * treeTypes.length)], worldCol: col, worldRow: row, cols: SCENERY_TREE_COLS, rows: SCENERY_TREE_ROWS, scale });
    markOccupied(col, row, SCENERY_TREE_COLS, SCENERY_TREE_ROWS);
  }

  return placements;
}

function generateOuterBushPlacements(
  farmCols: number, farmRows: number, worldCols: number, worldRows: number,
  overrides?: SceneryOverrides,
): { placements: Placement[]; occupied: Set<string> } {
  const rng = mulberry32(farmCols * 2000 + farmRows);
  const bushes: Placement[] = [];
  const occupied = new Set<string>();
  const fL = WORLD_PADDING, fT = WORLD_PADDING;
  const fR = WORLD_PADDING + farmCols - 1, fB = WORLD_PADDING + farmRows - 1;
  const scaleMin = 1.7, scaleMax = 2.2;
  const outerBushType = overrides?.outerBushType ?? DEFAULT_OUTER_BUSH;

  const addBush = (col: number, row: number) => {
    if (col < 0 || col >= worldCols || row < 0 || row >= worldRows) return;
    const key = `${col},${row}`;
    if (occupied.has(key)) return;
    occupied.add(key);
    const scale = scaleMin + rng() * (scaleMax - scaleMin);
    bushes.push({ itemType: outerBushType, worldCol: col, worldRow: row, cols: 1, rows: 1, scale });
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

// ─── Depth Calculation (matches frontend WorldRenderer) ──────────────────────

function computeDepth(p: Placement, itemDefs: Record<string, IGameItemDef>): number {
  const baseDepth = p.worldRow + p.rows - 1;
  const def = itemDefs[p.itemType];
  const cat = def?.category;
  if (cat === 'flooring' || cat === 'tiled_flooring') return -1e6 + baseDepth;
  if (cat === 'soil') return -5e5 + baseDepth;
  return baseDepth;
}

// ─── Image Fetching + Compositing ────────────────────────────────────────────

const imageCache = new Map<string, Buffer>();

async function fetchImage(url: string): Promise<Buffer> {
  const cached = imageCache.get(url);
  if (cached) return cached;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  imageCache.set(url, buf);
  return buf;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return { r: 126, g: 200, b: 126 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

/** Deterministic 2D noise 0–1 for grass texture. */
function noise2d(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
  return n - Math.floor(n);
}

// ─── Shared Compositing ──────────────────────────────────────────────────────

async function compositeToBuffer(
  items: ResolvedPlacement[],
  widthPx: number,
  heightPx: number,
  bgColor: string,
  grassNoiseStrength = 0,
): Promise<Buffer> {
  const sorted = [...items].sort((a, b) => a.depth - b.depth || a.left - b.left);

  const rgb = hexToRgb(bgColor);
  const baseBuffer = Buffer.alloc(widthPx * heightPx * 4);
  const seed = 12345;

  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      const i = (y * widthPx + x) * 4;
      let r = rgb.r, g = rgb.g, b = rgb.b;
      if (grassNoiseStrength > 0) {
        const n = noise2d(x * 0.1, y * 0.1, seed);
        const variation = (n - 0.5) * 2 * grassNoiseStrength;
        r = Math.round(Math.max(0, Math.min(255, r * (1 + variation))));
        g = Math.round(Math.max(0, Math.min(255, g * (1 + variation))));
        b = Math.round(Math.max(0, Math.min(255, b * (1 + variation))));
      }
      baseBuffer[i] = r;
      baseBuffer[i + 1] = g;
      baseBuffer[i + 2] = b;
      baseBuffer[i + 3] = 255;
    }
  }

  const composites: { input: Buffer; left: number; top: number }[] = [];
  let fetched = 0;
  let skipped = 0;

  for (const p of sorted) {
    try {
      const fullW = Math.round(p.width);
      const fullH = Math.round(p.height);
      if (fullW <= 0 || fullH <= 0) { skipped++; continue; }

      const rawLeft = Math.round(p.left);
      const rawTop = Math.round(p.top);
      const rot = p.rotationDegrees ?? 0;

      const buf = await fetchImage(p.imageUrl);
      let pipeline = sharp(buf)
        .resize(fullW, fullH, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .ensureAlpha();

      if (rot !== 0) {
        pipeline = pipeline.rotate(rot, {
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        });
      }

      const resized = await pipeline.png().toBuffer();

      let compositeLeft: number;
      let compositeTop: number;

      if (rot !== 0) {
        const rad = (rot * Math.PI) / 180;
        const cos = Math.abs(Math.cos(rad));
        const sin = Math.abs(Math.sin(rad));
        const rotW = Math.ceil(fullW * cos + fullH * sin);
        const rotH = Math.ceil(fullW * sin + fullH * cos);
        const centerX = rawLeft + fullW / 2;
        const centerY = rawTop + fullH / 2;
        compositeLeft = Math.round(centerX - rotW / 2);
        compositeTop = Math.round(centerY - rotH / 2);
      } else {
        const visLeft = Math.max(0, rawLeft);
        const visTop = Math.max(0, rawTop);
        const visRight = Math.min(widthPx, rawLeft + fullW);
        const visBottom = Math.min(heightPx, rawTop + fullH);
        const visW = visRight - visLeft;
        const visH = visBottom - visTop;
        if (visW <= 0 || visH <= 0) { skipped++; continue; }

        const needsCrop = visW < fullW || visH < fullH;
        if (needsCrop) {
          const cropped = await sharp(resized)
            .extract({
              left: visLeft - rawLeft,
              top: visTop - rawTop,
              width: visW,
              height: visH,
            })
            .png()
            .toBuffer();
          composites.push({ input: cropped, left: visLeft, top: visTop });
        } else {
          composites.push({ input: resized, left: visLeft, top: visTop });
        }
        fetched++;
        continue;
      }

      composites.push({ input: resized, left: compositeLeft, top: compositeTop });
      fetched++;
    } catch (err) {
      skipped++;
      if (skipped <= 5) log.warn({ url: p.imageUrl, err }, 'Skipped image during bake');
    }
  }

  log.info({ fetched, skipped, total: sorted.length }, 'Images fetched, compositing...');

  const BATCH = 80;
  let img = sharp(baseBuffer, { raw: { width: widthPx, height: heightPx, channels: 4 } });

  for (let i = 0; i < composites.length; i += BATCH) {
    const batch = composites.slice(i, i + BATCH);
    const output = await img.composite(batch).png().toBuffer();
    img = sharp(output);
  }

  return img.png().toBuffer();
}

async function uploadBake(pngBuffer: Buffer, folder: string): Promise<string> {
  return storageService.uploadBase64(
    `data:image/png;base64,${pngBuffer.toString('base64')}`,
    folder,
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const sceneryBakeService = {
  /**
   * Bakes a scenery PNG for the given farm size, uploads to R2,
   * and stores the record in MongoDB. Returns the public image URL.
   */
  async bake(farmCols: number, farmRows: number): Promise<{ imageUrl: string }> {
    log.info({ farmCols, farmRows }, 'Starting scenery bake');

    const itemDefsList = await GameItemDef.find().lean();
    const itemDefs: Record<string, IGameItemDef> = {};
    for (const d of itemDefsList) itemDefs[d.itemType] = d as IGameItemDef;

    const worldCols = farmCols + 2 * WORLD_PADDING;
    const worldRows = farmRows + 2 * WORLD_PADDING;

    const { placements: outerBushPlacements, occupied: outerBushOccupied } = generateOuterBushPlacements(farmCols, farmRows, worldCols, worldRows);
    const sceneryPlacements = generateSceneryPlacements(farmCols, farmRows, worldCols, worldRows, undefined, outerBushOccupied);
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
          const offset = applyBushOffset(p.worldCol, p.worldRow, left, top, farmCols, farmRows);
          left = offset.left;
          top = offset.top;
        }
        return {
          left,
          top,
          width: w,
          height: h,
          imageUrl,
          depth: computeDepth(p, itemDefs),
        };
      })
      .filter((r): r is ResolvedPlacement => r !== null);

    const widthPx = worldCols * TILE_SIZE * BAKE_SCALE;
    const heightPx = worldRows * TILE_SIZE * BAKE_SCALE;
    const scaledResolved: ResolvedPlacement[] = resolved.map((r) => ({
      ...r,
      left: r.left * BAKE_SCALE,
      top: r.top * BAKE_SCALE,
      width: r.width * BAKE_SCALE,
      height: r.height * BAKE_SCALE,
    }));
    const pngBuffer = await compositeToBuffer(scaledResolved, widthPx, heightPx, FARM_GRASS_COLOR, 0.04);
    const imageUrl = await uploadBake(pngBuffer, `scenery/${farmCols}x${farmRows}`);

    await BakedScenery.findOneAndUpdate(
      { farmCols, farmRows },
      { imageUrl },
      { upsert: true, new: true },
    );

    log.info({ farmCols, farmRows, imageUrl }, 'Procedural scenery bake complete');
    return { imageUrl };
  },

  /**
   * Bakes a scenery PNG from a Scene document's manual placements.
   * Uses sub-pixel x/y positions (no grid snapping).
   */
  async bakeScene(scene: IScene): Promise<{ imageUrl: string }> {
    log.info({ slug: scene.slug, cols: scene.cols, rows: scene.rows }, 'Starting scene bake');

    const itemDefsList = await GameItemDef.find().lean();
    const itemDefs: Record<string, IGameItemDef> = {};
    for (const d of itemDefsList) itemDefs[d.itemType] = d as IGameItemDef;

    const widthPx = scene.cols * TILE_SIZE * BAKE_SCALE;
    const heightPx = scene.rows * TILE_SIZE * BAKE_SCALE;

    const resolved: ResolvedPlacement[] = [];

    if (scene.tiledFlooringItemType) {
      const tileDef = itemDefs[scene.tiledFlooringItemType];
      if (tileDef?.imageUrl) {
        const tileW = 5 * TILE_SIZE * BAKE_SCALE;
        const tileH = 5 * TILE_SIZE * BAKE_SCALE;
        const tileCols = Math.ceil(scene.cols / 5);
        const tileRows = Math.ceil(scene.rows / 5);
        for (let row = 0; row < tileRows; row++) {
          for (let col = 0; col < tileCols; col++) {
            resolved.push({
              left: col * tileW,
              top: row * tileH,
              width: tileW,
              height: tileH,
              imageUrl: tileDef.imageUrl,
              depth: -1e7,
            });
          }
        }
      }
    }

    resolved.push(
      ...scene.placements
      .map((p) => {
        const def = itemDefs[p.itemType];
        if (!def?.imageUrl) return null;
        const s = p.scale;
        const baseW = TILE_SIZE * (def.cols ?? 1);
        const baseH = TILE_SIZE * (def.rows ?? 1);
        const w = baseW * s;
        const h = baseH * s;
        const baseDepth = (p.y + baseH) / TILE_SIZE;
        const cat = def.category;
        let depth = baseDepth;
        if (cat === 'flooring' || cat === 'tiled_flooring') depth = -1e6 + baseDepth;
        else if (cat === 'soil') depth = -5e5 + baseDepth;
        depth += p.depthOffset ?? 0;
        const r: ResolvedPlacement = {
          left: (p.x + (baseW - w) / 2) * BAKE_SCALE,
          top: (p.y + (baseH - h)) * BAKE_SCALE,
          width: w * BAKE_SCALE,
          height: h * BAKE_SCALE,
          imageUrl: def.imageUrl,
          depth,
        };
        if (p.rotationDegrees != null) r.rotationDegrees = p.rotationDegrees;
        return r;
      })
      .filter((r): r is ResolvedPlacement => r !== null),
    );

    const grassNoise = scene.grassNoiseStrength ?? 0.04;
    const pngBuffer = await compositeToBuffer(resolved, widthPx, heightPx, scene.bgColor, grassNoise);
    const imageUrl = await uploadBake(pngBuffer, `scenes/${scene.slug}`);

    log.info({ slug: scene.slug, imageUrl }, 'Scene bake complete');
    return { imageUrl };
  },

  /**
   * Returns the procedural placements as scene-editor-compatible objects
   * (sub-pixel x/y) so admins can load them into the editor and tweak manually.
   */
  async precomputePlacements(
    farmCols: number, farmRows: number,
    overrides?: SceneryOverrides,
  ): Promise<Array<{ id: string; itemType: string; x: number; y: number; scale: number }>> {
    const worldCols = farmCols + 2 * WORLD_PADDING;
    const worldRows = farmRows + 2 * WORLD_PADDING;

    const { placements: outerBushPlacements, occupied: outerBushOccupied } = generateOuterBushPlacements(farmCols, farmRows, worldCols, worldRows, overrides);
    const sceneryPlacements = generateSceneryPlacements(farmCols, farmRows, worldCols, worldRows, overrides, outerBushOccupied);
    const placements: Placement[] = [...outerBushPlacements, ...sceneryPlacements];

    // Match the bake() resolved positioning: x/y represent the top-left of the
    // *unscaled* tile area so the editor renders identically to the baked image.
    // Apply bush offset for outer bush placements (cols===1, rows===1).
    return placements.map((p, i) => {
      let x = p.worldCol * TILE_SIZE;
      let y = p.worldRow * TILE_SIZE;
      if (p.cols === 1 && p.rows === 1) {
        const baseW = TILE_SIZE * p.cols;
        const baseH = TILE_SIZE * p.rows;
        const w = baseW * (p.scale ?? 1);
        const h = baseH * (p.scale ?? 1);
        const left = x + (baseW - w) / 2;
        const top = y + (baseH - h) / 2;
        const offset = applyBushOffset(p.worldCol, p.worldRow, left, top, farmCols, farmRows);
        x = offset.left - (baseW - w) / 2;
        y = offset.top - (baseH - h) / 2;
      }
      return {
        id: `proc_${i}_${p.itemType}`,
        itemType: p.itemType,
        x,
        y,
        scale: p.scale ?? 1,
      };
    });
  },

  async getForSize(farmCols: number, farmRows: number): Promise<string | null> {
    const record = await BakedScenery.findOne({ farmCols, farmRows }).lean();
    return record?.imageUrl ?? null;
  },

  async listAll(): Promise<Array<{ farmCols: number; farmRows: number; imageUrl: string; updatedAt: Date }>> {
    const records = await BakedScenery.find().sort({ farmCols: 1, farmRows: 1 }).lean();
    return records.map((r) => ({
      farmCols: r.farmCols,
      farmRows: r.farmRows,
      imageUrl: r.imageUrl,
      updatedAt: r.updatedAt,
    }));
  },
};
