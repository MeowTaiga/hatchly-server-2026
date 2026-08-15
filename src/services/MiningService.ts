import { GameItemDef, type IGameItemDef } from '../models/GameItemDef.js';
import { Scene } from '../models/Scene.js';
import {
  isMiningOreType,
  miningMinigameParams,
  miningOreDef,
  oreDropItemType,
  ORE_LABELS,
  type MiningOreType,
} from '../constants/miningOres.js';
import { farmService, withQuestSync, type StateUpdate } from './FarmService.js';
import { questService } from './quests/index.js';
import { SKILL_XP_REWARDS } from '../constants/skills.js';
import { attachSkillXp, skillXpService } from './SkillXpService.js';
import {
  consumeMiningEnergy,
  miningEnergyStateUpdate,
  refundMiningEnergy,
  syncMiningEnergy,
} from './MiningEnergy.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('MiningService');

const MINE_COOLDOWN_MS = 2500;
const TAP_SLACK = 0.85;
const TIME_SLACK_MS = 800;
const cooldowns = new Map<string, number>();

interface MineSession {
  userId: string;
  sceneSlug: string;
  col: number;
  row: number;
  oreType: MiningOreType;
  itemType: string;
  tapsRequired: number;
  timeLimitMs: number;
  startedAt: number;
  energyCharged: boolean;
}

const sessions = new Map<string, MineSession>();

function sessionKey(userId: string): string {
  return userId;
}

function cooldownKey(userId: string, sceneSlug: string, col: number, row: number): string {
  return `${userId}:${sceneSlug}:${col}:${row}`;
}

function inventoryToRecord(map: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of map) {
    if (v > 0) out[k] = v;
  }
  return out;
}

function isPickaxe(itemType: string | undefined, itemDefs: Record<string, IGameItemDef>): boolean {
  if (!itemType) return false;
  const sub = itemDefs[itemType]?.subCategory;
  return sub === 'pickaxe' || sub === 'pickaxes';
}

export interface MineReadyPayload {
  sceneSlug: string;
  col: number;
  row: number;
  oreType: MiningOreType;
  itemType: string;
  label: string;
  imageUrl?: string;
  emoji?: string;
  tapsRequired: number;
  timeLimitMs: number;
  difficulty: number;
  miningEnergy: number;
  miningEnergyCap: number;
  miningEnergyAt: number;
}

export interface MineOreResult {
  sceneSlug: string;
  col: number;
  row: number;
  oreType: MiningOreType;
  itemType: string;
  label: string;
  qty: number;
  passed: boolean;
  imageUrl?: string;
  rarity?: string;
}

async function loadItemDefs(): Promise<Record<string, IGameItemDef>> {
  const itemDefsMap = await GameItemDef.find().lean();
  return Object.fromEntries(itemDefsMap.map((d) => [d.itemType, d]));
}

async function resolveVein(
  userId: string,
  sceneSlug: string,
  col: number,
  row: number,
): Promise<{ oreType: MiningOreType; itemType: string; def: IGameItemDef }> {
  const until = cooldowns.get(cooldownKey(userId, sceneSlug, col, row)) ?? 0;
  if (Date.now() < until) throw new Error('That vein needs a moment…');

  const scene = await Scene.findOne({ slug: sceneSlug }).lean();
  if (!scene) throw new Error('Scene not found');

  const tile = (scene.miningTiles ?? []).find((t) => t.col === col && t.row === row);
  if (!tile) throw new Error('Nothing to mine here');

  const oreTypeRaw = tile.oreType ?? 'copper';
  if (!isMiningOreType(oreTypeRaw)) throw new Error('Unknown ore type');

  const farm = await farmService.loadOrCreateFarm(userId);
  const itemDefs = await loadItemDefs();
  const handTool = farm.equipped?.handTool;
  if (!handTool || !isPickaxe(handTool, itemDefs)) {
    throw new Error('Equip a pickaxe to mine');
  }

  const itemType = oreDropItemType(oreTypeRaw);
  const dropDef = itemDefs[itemType];
  if (!dropDef) throw new Error(`Missing item def for ${itemType} — run mining seed`);

  return { oreType: oreTypeRaw, itemType, def: dropDef };
}

export async function beginMine(
  userId: string,
  sceneSlug: string,
  col: number,
  row: number,
): Promise<{ ready: MineReadyPayload; stateUpdate: StateUpdate }> {
  const { oreType, itemType, def } = await resolveVein(userId, sceneSlug, col, row);
  const meta = miningOreDef(oreType)!;
  const { tapsRequired, timeLimitMs } = miningMinigameParams(meta.difficulty);

  const farm = await farmService.loadOrCreateFarm(userId);
  const existing = sessions.get(sessionKey(userId));
  if (existing?.energyCharged) {
    sessions.delete(sessionKey(userId));
    await refundMiningEnergy(userId, farm);
  }
  const energy = await consumeMiningEnergy(userId, farm);

  sessions.set(sessionKey(userId), {
    userId,
    sceneSlug,
    col,
    row,
    oreType,
    itemType,
    tapsRequired,
    timeLimitMs,
    startedAt: Date.now(),
    energyCharged: true,
  });

  const energyFields = miningEnergyStateUpdate(energy);
  return {
    ready: {
      sceneSlug,
      col,
      row,
      oreType,
      itemType,
      label: def.label ?? ORE_LABELS[oreType] ?? oreType,
      ...(def.imageUrl ? { imageUrl: def.imageUrl } : {}),
      ...(def.emoji ? { emoji: def.emoji } : {}),
      tapsRequired,
      timeLimitMs,
      difficulty: meta.difficulty,
      ...energyFields,
    },
    stateUpdate: energyFields,
  };
}

export async function cancelMine(userId: string): Promise<StateUpdate | undefined> {
  const session = sessions.get(sessionKey(userId));
  sessions.delete(sessionKey(userId));
  if (!session?.energyCharged) return undefined;

  const farm = await farmService.loadOrCreateFarm(userId);
  const energy = await refundMiningEnergy(userId, farm);
  return miningEnergyStateUpdate(energy);
}

export async function completeMine(
  userId: string,
  input: { sceneSlug: string; col: number; row: number; taps: number; elapsedMs: number; passed: boolean },
): Promise<{ result: MineOreResult; stateUpdate?: StateUpdate }> {
  const session = sessions.get(sessionKey(userId));
  sessions.delete(sessionKey(userId));

  const fail = (reason: string): { result: MineOreResult } => {
    log.info({ userId, reason }, 'Mine failed');
    return {
      result: {
        sceneSlug: input.sceneSlug,
        col: input.col,
        row: input.row,
        oreType: (session?.oreType ?? 'stone') as MiningOreType,
        itemType: session?.itemType ?? 'stone',
        label: ORE_LABELS[session?.oreType ?? ''] ?? 'Ore',
        qty: 0,
        passed: false,
      },
    };
  };

  if (!session) return fail('no session');
  if (session.sceneSlug !== input.sceneSlug || session.col !== input.col || session.row !== input.row) {
    return fail('tile mismatch');
  }
  if (!input.passed) return fail('minigame failed');

  const minTaps = Math.ceil(session.tapsRequired * TAP_SLACK);
  const maxElapsed = session.timeLimitMs + TIME_SLACK_MS;
  if (input.taps < minTaps) return fail('not enough taps');
  if (input.elapsedMs > maxElapsed) return fail('too slow');

  const { oreType, itemType, def } = await resolveVein(userId, session.sceneSlug, session.col, session.row);
  const farm = await farmService.loadOrCreateFarm(userId);
  const qty = 1;
  farm.inventory.set(itemType, (farm.inventory.get(itemType) ?? 0) + qty);
  farm.markModified('inventory');
  const energy = await syncMiningEnergy(userId, farm);
  await farm.save();

  cooldowns.set(cooldownKey(userId, session.sceneSlug, session.col, session.row), Date.now() + MINE_COOLDOWN_MS);

  const label = def.label ?? ORE_LABELS[oreType];
  log.info({ userId, sceneSlug: session.sceneSlug, col: session.col, row: session.row, oreType, itemType }, 'Ore mined');

  const sync = await questService.recordEvents(userId, {
    kind: 'action',
    action: 'mine_ore',
    itemType,
  });
  const skillGrant = await skillXpService.grant(userId, 'mining', SKILL_XP_REWARDS.mine_ore);

  const stateUpdate: StateUpdate = attachSkillXp(
    withQuestSync(
      {
        farmXp: farm.xp,
        gems: farm.gems,
        inventory: inventoryToRecord(farm.inventory),
        ...miningEnergyStateUpdate(energy),
      },
      sync,
    ),
    skillGrant,
  );

  return {
    result: {
      sceneSlug: session.sceneSlug,
      col: session.col,
      row: session.row,
      oreType,
      itemType,
      label,
      qty,
      passed: true,
      ...(def.imageUrl ? { imageUrl: def.imageUrl } : {}),
      rarity: miningOreDef(oreType)?.rarity ?? 'common',
    },
    stateUpdate,
  };
}
