import { SceneInstance, type PlayerState, type WalkBounds } from './SceneInstance.js';
import { Scene } from '../models/Scene.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('MultiplayerManager');

const TILE_SIZE = 48;
const CLEANUP_INTERVAL_MS = 30_000;
const EMPTY_GRACE_MS = 30_000;

interface SceneConfig {
  walkBounds: WalkBounds | null;
  unwalkableTiles: Array<{ col: number; row: number }>;
  spawnX?: number;
  spawnY?: number;
}

interface JoinResult {
  instanceId: string;
  roomName: string;
  players: PlayerState[];
  self: PlayerState;
}

class MultiplayerManager {
  private scenes = new Map<string, SceneInstance[]>();
  private userInstance = new Map<string, SceneInstance>();
  private sceneConfigs = new Map<string, SceneConfig>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    log.info('Multiplayer manager started');
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  async joinScene(
    userId: string,
    sceneSlug: string,
    username: string,
    petName: string,
    petImageUrl: string,
    petPose?: Record<string, string>,
    equipped?: { handTool?: string; bobber?: string; chair?: string },
  ): Promise<JoinResult> {
    if (this.userInstance.has(userId)) {
      this.leaveScene(userId);
    }

    const config = await this.getSceneConfig(sceneSlug);

    const instances = this.scenes.get(sceneSlug) ?? [];
    let instance = instances.find((i) => !i.isFull());

    if (!instance) {
      instance = new SceneInstance({ sceneSlug, walkBounds: config.walkBounds, unwalkableTiles: config.unwalkableTiles, spawnX: config.spawnX, spawnY: config.spawnY });
      instances.push(instance);
      this.scenes.set(sceneSlug, instances);
      log.info({ sceneSlug, instanceId: instance.instanceId }, 'New instance created');
    }

    const self = instance.addPlayer(userId, username, petName, petImageUrl, petPose, equipped);
    this.userInstance.set(userId, instance);

    log.info({ userId, sceneSlug, instanceId: instance.instanceId, count: instance.playerCount() }, 'Player joined');

    return {
      instanceId: instance.instanceId,
      roomName: instance.roomName,
      players: instance.getPlayerList(),
      self,
    };
  }

  private async getSceneConfig(slug: string): Promise<SceneConfig> {
    const cached = this.sceneConfigs.get(slug);
    if (cached) return cached;

    const scene = await Scene.findOne({ slug }).lean();
    let walkBounds: WalkBounds | null = null;
    if (scene?.walkableRect) {
      walkBounds = { x: scene.walkableRect.x, y: scene.walkableRect.y, w: scene.walkableRect.w, h: scene.walkableRect.h };
    } else if (scene) {
      const offsetX = ((scene.cols - scene.farmCols) / 2) * TILE_SIZE;
      const offsetY = ((scene.rows - scene.farmRows) / 2) * TILE_SIZE;
      walkBounds = {
        x: offsetX,
        y: offsetY,
        w: scene.farmCols * TILE_SIZE,
        h: scene.farmRows * TILE_SIZE,
      };
    }
    const config: SceneConfig = {
      walkBounds,
      unwalkableTiles: scene?.unwalkableTiles ?? [],
      spawnX: scene?.spawnX,
      spawnY: scene?.spawnY,
    };
    this.sceneConfigs.set(slug, config);
    return config;
  }

  leaveScene(userId: string): { roomName: string; sceneSlug: string } | null {
    const instance = this.userInstance.get(userId);
    if (!instance) return null;

    instance.removePlayer(userId);
    this.userInstance.delete(userId);

    log.info({ userId, instanceId: instance.instanceId, remaining: instance.playerCount() }, 'Player left');

    return { roomName: instance.roomName, sceneSlug: instance.sceneSlug };
  }

  movePlayer(userId: string, x: number, y: number): { roomName: string; clampedX: number; clampedY: number } | null {
    const instance = this.userInstance.get(userId);
    if (!instance) return null;
    instance.updatePosition(userId, x, y);
    const player = instance.getPlayer(userId);
    return { roomName: instance.roomName, clampedX: player!.x, clampedY: player!.y };
  }

  updatePlayerEquipped(userId: string, slot: 'handTool' | 'bobber' | 'chair', value: string | null): boolean {
    const instance = this.userInstance.get(userId);
    if (!instance) return false;
    return instance.updateEquipped(userId, slot, value);
  }

  getInstanceForUser(userId: string): SceneInstance | undefined {
    return this.userInstance.get(userId);
  }

  getRoomForUser(userId: string): string | null {
    return this.userInstance.get(userId)?.roomName ?? null;
  }

  /**
   * Bind a synthetic presence (stress-test bots) so getInstanceForUser works
   * for trade / profile lookups. Does not call addPlayer — caller already did.
   */
  bindPresence(userId: string, instance: SceneInstance): void {
    this.userInstance.set(userId, instance);
  }

  /** Unbind synthetic presence without leaving real players. */
  unbindPresence(userId: string): void {
    this.userInstance.delete(userId);
  }

  async invalidateSceneConfig(slug: string): Promise<void> {
    this.sceneConfigs.delete(slug);
    const config = await this.getSceneConfig(slug);
    const instances = this.scenes.get(slug) ?? [];
    for (const inst of instances) {
      inst.updateUnwalkableTiles(config.unwalkableTiles);
      inst.updateSpawn(config.spawnX, config.spawnY);
    }
    log.debug({ slug, instances: instances.length }, 'Scene config cache invalidated');
  }

  private cleanup(): void {
    for (const [slug, instances] of this.scenes) {
      const kept: SceneInstance[] = [];
      for (const inst of instances) {
        if (inst.isEmpty() && inst.getAge() > EMPTY_GRACE_MS) {
          log.info({ sceneSlug: slug, instanceId: inst.instanceId }, 'Destroying empty instance');
          continue;
        }
        kept.push(inst);
      }
      if (kept.length === 0) {
        this.scenes.delete(slug);
      } else {
        this.scenes.set(slug, kept);
      }
    }
  }
}

export const multiplayerManager = new MultiplayerManager();
