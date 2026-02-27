import mongoose, { Schema, type Document } from 'mongoose';

export interface IScenePlacement {
  id: string;
  itemType: string;
  /** Sub-pixel X position (not grid-snapped). */
  x: number;
  /** Sub-pixel Y position (not grid-snapped). */
  y: number;
  /** Visual scale multiplier (default 1). */
  scale: number;
  /** Manual layer offset: positive = render on top, negative = render behind. */
  depthOffset?: number;
  /** Rotation in degrees, 0–360 (default 0). */
  rotationDegrees?: number;
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
  /** Grid tiles (col, row) that are fishing spots. spotType: river, ocean, pond, general. */
  fishingTiles?: Array<{ col: number; row: number; spotType?: string }>;
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
    depthOffset: { type: Number },
    rotationDegrees: { type: Number },
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

const sceneSchema = new Schema<IScene>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    cols: { type: Number, required: true },
    rows: { type: Number, required: true },
    bgColor: { type: String, default: '#7EC87E' },
    tiledFlooringItemType: { type: String },
    grassNoiseStrength: { type: Number, default: 0.04 },
    farmCols: { type: Number, required: true },
    farmRows: { type: Number, required: true },
    placements: { type: [scenePlacementSchema], default: [] },
    walkableRect: { type: walkableRectSchema },
    unwalkableTiles: { type: [unwalkableTileSchema], default: [] },
    fishingTiles: { type: [fishingTileSchema], default: [] },
    bakedImageUrl: { type: String },
    spawnX: { type: Number },
    spawnY: { type: Number },
  },
  { timestamps: true },
);

export const Scene = mongoose.model<IScene>('Scene', sceneSchema);
