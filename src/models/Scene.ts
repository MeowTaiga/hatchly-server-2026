import mongoose, { Schema, type Document } from 'mongoose';

export interface IScenePlacement {
  id: string;
  itemType: string;
  /** Sub-pixel X position (not grid-snapped). */
  x: number;
  /** Sub-pixel Y position (not grid-snapped). */
  y: number;
  /** Uniform scale multiplier (default 1). Used when an axis override is absent. */
  scale: number;
  /** Horizontal scale override, for placements stretched on one axis. */
  scaleX?: number;
  /** Vertical scale override, for placements stretched on one axis. */
  scaleY?: number;
  /** Manual layer offset: positive = render on top, negative = render behind. */
  depthOffset?: number;
  /** Rotation in degrees, 0–360 (default 0). */
  rotationDegrees?: number;
  /** Mirror horizontally (about the vertical axis through the sprite center). */
  flipX?: boolean;
  /** Mirror vertically (about the horizontal axis through the sprite center). */
  flipY?: boolean;
  /** Hue rotation in degrees (0 = unchanged). Bake + live sprites. */
  hueDegrees?: number;
  /** Saturation multiplier (1 = unchanged). Bake + live sprites. */
  saturation?: number;
  /** Brightness multiplier (1 = unchanged). Bake + live sprites. */
  brightness?: number;
  /** Contrast multiplier (1 = unchanged). Bake + live sprites. */
  contrast?: number;
  /**
   * Lift dark tones (0–100, default 0). Softens crushed blacks / dark outlines.
   * Bake + live sprites.
   */
  shadowLift?: number;
  /**
   * Pull down bright tones (0–100, default 0). Softens hot whites.
   * Bake + live sprites.
   */
  highlightCompress?: number;
  /**
   * Warm ↔ cool balance (−100…100, default 0). Positive warms (more orange),
   * negative cools (more blue). Bake + live sprites.
   */
  warmth?: number;
  /** Opacity 0–1 (default 1). Bake + live sprites. */
  opacity?: number;
  /** Edge fade 0–100 (% of that side). Bake + live sprites. */
  featherTop?: number;
  featherRight?: number;
  featherBottom?: number;
  featherLeft?: number;
  /** Hex colour punched out of the sprite (chroma key). Bake + editor preview. */
  knockoutColor?: string;
  /** Match tightness 0–100 for knockoutColor (default 22). */
  knockoutTolerance?: number;
  /**
   * How this placement composites (default "over").
   * Bake + live sprites (e.g. multiply / screen).
   */
  blendMode?: string;
  /**
   * When true, the placement is omitted from the baked PNG and drawn as a
   * live sprite so pets can walk behind it (depth-sorted against players).
   */
  live?: boolean;
}

/** Colour / opacity grade for the repeating tiled floor (same knobs as placements). */
export interface ISceneColourGrade {
  hueDegrees?: number;
  saturation?: number;
  brightness?: number;
  contrast?: number;
  shadowLift?: number;
  highlightCompress?: number;
  warmth?: number;
  opacity?: number;
  blendMode?: string;
}

export interface IWalkableRect {
  /** Left edge in pixels from scene origin. */
  x: number;
  /** Top edge in pixels from scene origin. */
  y: number;
  /** Width in pixels. */
  w: number;
  /** Height in pixels. */
  h: number;
}

export interface IScene extends Document {
  name: string;
  slug: string;
  cols: number;
  rows: number;
  /** Hex background color (e.g. "#7EC87E"). Fallback when no tiled flooring. */
  bgColor: string;
  /** Item type from tiled_flooring category to tile across ground (5x5 grid cells per tile). */
  tiledFlooringItemType?: string;
  /** Colour / opacity grade for the repeating tiled floor. */
  tiledFlooringStyle?: ISceneColourGrade;
  /** Grass layer noise strength 0–0.15. Subtle texture so ground isn't flat. Default 0.04. */
  grassNoiseStrength?: number;
  /** Farm bounds to overlay in the editor — defines the playable area. */
  farmCols: number;
  farmRows: number;
  placements: IScenePlacement[];
  /** Rectangular outer boundary (default: farm bounds). If absent, entire scene. */
  walkableRect?: IWalkableRect;
  /** Grid tiles (col, row) that are unwalkable inside the boundary. */
  unwalkableTiles?: Array<{ col: number; row: number }>;
  /** Grid tiles (col, row) that are fishing spots. spotType: river, ocean, pond, lake, reef, general. */
  fishingTiles?: Array<{ col: number; row: number; spotType?: string }>;
  /** Grid tiles (col, row) that are mineable ore veins. oreType: coal, copper, tin, iron, silver, gold, mithril. */
  miningTiles?: Array<{ col: number; row: number; oreType?: string }>;
  /** R2 URL of the baked PNG (null if not yet baked). */
  bakedImageUrl?: string;
  /** Player spawn X coordinate (pixels). Defaults to center of farm bounds. */
  spawnX?: number;
  /** Player spawn Y coordinate (pixels). Defaults to center of farm bounds. */
  spawnY?: number;
  createdAt: Date;
  updatedAt: Date;
}

const scenePlacementSchema = new Schema<IScenePlacement>(
  {
    id: { type: String, required: true },
    itemType: { type: String, required: true },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    scale: { type: Number, default: 1 },
    scaleX: { type: Number },
    scaleY: { type: Number },
    depthOffset: { type: Number },
    rotationDegrees: { type: Number },
    flipX: { type: Boolean },
    flipY: { type: Boolean },
    hueDegrees: { type: Number },
    saturation: { type: Number },
    brightness: { type: Number },
    contrast: { type: Number },
    shadowLift: { type: Number },
    highlightCompress: { type: Number },
    warmth: { type: Number },
    opacity: { type: Number },
    featherTop: { type: Number },
    featherRight: { type: Number },
    featherBottom: { type: Number },
    featherLeft: { type: Number },
    knockoutColor: { type: String },
    knockoutTolerance: { type: Number },
    blendMode: { type: String },
    live: { type: Boolean },
  },
  { _id: false },
);

const sceneColourGradeSchema = new Schema<ISceneColourGrade>(
  {
    hueDegrees: { type: Number },
    saturation: { type: Number },
    brightness: { type: Number },
    contrast: { type: Number },
    shadowLift: { type: Number },
    highlightCompress: { type: Number },
    warmth: { type: Number },
    opacity: { type: Number },
    blendMode: { type: String },
  },
  { _id: false },
);

const walkableRectSchema = new Schema<IWalkableRect>(
  {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    w: { type: Number, required: true },
    h: { type: Number, required: true },
  },
  { _id: false },
);

const unwalkableTileSchema = new Schema(
  { col: { type: Number, required: true }, row: { type: Number, required: true } },
  { _id: false },
);

const fishingTileSchema = new Schema(
  {
    col: { type: Number, required: true },
    row: { type: Number, required: true },
    spotType: { type: String, default: 'general' },
  },
  { _id: false },
);

const miningTileSchema = new Schema(
  {
    col: { type: Number, required: true },
    row: { type: Number, required: true },
    oreType: { type: String, default: 'copper' },
  },
  { _id: false },
);

const sceneSchema = new Schema<IScene>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    cols: { type: Number, required: true },
    rows: { type: Number, required: true },
    bgColor: { type: String, default: '#7EC87E' },
    tiledFlooringItemType: { type: String },
    tiledFlooringStyle: { type: sceneColourGradeSchema },
    grassNoiseStrength: { type: Number, default: 0.04 },
    farmCols: { type: Number, required: true },
    farmRows: { type: Number, required: true },
    placements: { type: [scenePlacementSchema], default: [] },
    walkableRect: { type: walkableRectSchema },
    unwalkableTiles: { type: [unwalkableTileSchema], default: [] },
    fishingTiles: { type: [fishingTileSchema], default: [] },
    miningTiles: { type: [miningTileSchema], default: [] },
    bakedImageUrl: { type: String },
    spawnX: { type: Number },
    spawnY: { type: Number },
  },
  { timestamps: true },
);

export const Scene = mongoose.model<IScene>('Scene', sceneSchema);
