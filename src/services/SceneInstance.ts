import { randomUUID } from 'crypto';

export interface PlayerState {
  userId: string;
  username: string;
  petName: string;
  petImageUrl: string;
  petPose?: Record<string, string>;
  activePose: string | null;
  x: number;
  y: number;
  lastActivity: number;
  equippedHandTool?: string;
  equippedBobber?: string;
  equippedChair?: string;
}

export interface WalkBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

const TILE_SIZE = 48;

/** Set of "col,row" for unwalkable tiles. */
export type UnwalkableSet = Set<string>;

export interface SceneInstanceOptions {
  sceneSlug: string;
  maxPlayers?: number;
  spawnX?: number;
  spawnY?: number;
  walkBounds?: WalkBounds | null;
  unwalkableTiles?: Array<{ col: number; row: number }>;
}

const DEFAULT_MAX_PLAYERS = 30;

export class SceneInstance {
  readonly instanceId: string;
  readonly sceneSlug: string;
  readonly roomName: string;
  readonly maxPlayers: number;
  private _spawnX: number;
  private _spawnY: number;
  readonly walkBounds: WalkBounds | null;
  private _unwalkableSet: UnwalkableSet;

  get spawnX(): number {
    return this._spawnX;
  }

  get spawnY(): number {
    return this._spawnY;
  }

  get unwalkableSet(): UnwalkableSet {
    return this._unwalkableSet;
  }

  private players = new Map<string, PlayerState>();
  private createdAt = Date.now();

  constructor(opts: SceneInstanceOptions) {
    this.instanceId = randomUUID();
    this.sceneSlug = opts.sceneSlug;
    this.maxPlayers = opts.maxPlayers ?? DEFAULT_MAX_PLAYERS;
    this._spawnX = opts.spawnX ?? 400;
    this._spawnY = opts.spawnY ?? 500;
    this.walkBounds = opts.walkBounds ?? null;
    const tiles = opts.unwalkableTiles ?? [];
    this._unwalkableSet = new Set(tiles.map((t) => `${t.col},${t.row}`));
    this.roomName = `mp:${this.sceneSlug}:${this.instanceId}`;
  }

  isFull(): boolean {
    return this.players.size >= this.maxPlayers;
  }

  isEmpty(): boolean {
    return this.players.size === 0;
  }

  playerCount(): number {
    return this.players.size;
  }

  hasPlayer(userId: string): boolean {
    return this.players.has(userId);
  }

  updateSpawn(x?: number, y?: number): void {
    if (x != null) this._spawnX = x;
    if (y != null) this._spawnY = y;
  }

  addPlayer(
    userId: string,
    username: string,
    petName: string,
    petImageUrl: string,
    petPose?: Record<string, string>,
    equipped?: { handTool?: string; bobber?: string; chair?: string },
  ): PlayerState {
    const state: PlayerState = {
      userId,
      username,
      petName,
      petImageUrl,
      petPose,
      activePose: null,
      x: this._spawnX,
      y: this._spawnY,
      lastActivity: Date.now(),
      ...(equipped?.handTool && { equippedHandTool: equipped.handTool }),
      ...(equipped?.bobber && { equippedBobber: equipped.bobber }),
      ...(equipped?.chair && { equippedChair: equipped.chair }),
    };
    this.players.set(userId, state);
    return state;
  }

  removePlayer(userId: string): boolean {
    return this.players.delete(userId);
  }

  updatePosition(userId: string, x: number, y: number): boolean {
    const p = this.players.get(userId);
    if (!p) return false;
    const clamped = this.clampToWalkable(x, y, p.x, p.y);
    p.x = clamped.x;
    p.y = clamped.y;
    p.lastActivity = Date.now();
    return true;
  }

  clampToWalkable(x: number, y: number, prevX: number, prevY: number): { x: number; y: number } {
    const b = this.walkBounds;
    let cx = x;
    let cy = y;
    if (b) {
      cx = Math.max(b.x, Math.min(x, b.x + b.w - 1));
      cy = Math.max(b.y, Math.min(y, b.y + b.h - 1));
    }
    const col = Math.floor(cx / TILE_SIZE);
    const row = Math.floor(cy / TILE_SIZE);
    if (this._unwalkableSet.has(`${col},${row}`)) {
      return { x: prevX, y: prevY };
    }
    return { x: cx, y: cy };
  }

  setPose(userId: string, pose: string | null): boolean {
    const p = this.players.get(userId);
    if (!p) return false;
    p.activePose = pose;
    p.lastActivity = Date.now();
    return true;
  }

  updateUnwalkableTiles(tiles: Array<{ col: number; row: number }>): void {
    this._unwalkableSet = new Set(tiles.map((t) => `${t.col},${t.row}`));
  }

  getPlayer(userId: string): PlayerState | undefined {
    return this.players.get(userId);
  }

  getPlayerList(): PlayerState[] {
    return Array.from(this.players.values());
  }

  getAge(): number {
    return Date.now() - this.createdAt;
  }
}
