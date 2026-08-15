import { randomUUID } from 'crypto';
import { Farm } from '../models/Farm.js';
import { withQuestSync, type StateUpdate } from './FarmService.js';
import { questService } from './quests/index.js';
import { SKILL_XP_REWARDS } from '../constants/skills.js';
import { attachSkillXp, skillXpService } from './SkillXpService.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('SpiritSnatch');

const CANDY_ITEM = 'candy_corn';
const COOLDOWN_MS = 60 * 60 * 1000;
const ROUND_MS = 24_000;
const ROUND_GRACE_MS = 8_000;
const TRICK_PENALTY = 2;
const MAX_CANDY_PER_ROUND = 10;
const CATCH_START = 0.70;
const CATCH_END = 0.94;
const CATCH_FRAC = CATCH_END - CATCH_START;
const TAP_SLACK_MS = 380;
const MAX_TAPS = 100;

/** Fall duration at round start — a bit slower than the previous 4600ms. */
const FALL_MS_START = 5200;
/** Previous typical speed, reached at 25% of the round. */
const FALL_MS_QUARTER = 4600;
/** Keep accelerating after the quarter mark. */
const FALL_MS_END = 2800;

export interface SpiritSnatchTarget {
  id: number;
  kind: 'treat' | 'trick';
  xFrac: number;
  spawnAt: number;
  fallMs: number;
  driftFrac: number;
}

export interface SpiritSnatchRound {
  roundId: string;
  roundMs: number;
  catchStart: number;
  catchEnd: number;
  targets: SpiritSnatchTarget[];
}

export interface SpiritSnatchTap {
  id: number;
  atMs: number;
}

export interface SpiritSnatchResult {
  score: number;
  candyAwarded: number;
}

export type SpiritSnatchStartResult =
  | { ok: true; round: SpiritSnatchRound }
  | { ok: false; onCooldown: true; nextAvailableAt: string; message: string };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

function inventoryRecord(farm: { inventory: Map<string, number> }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of farm.inventory) {
    if (v > 0) out[k] = v;
  }
  return out;
}

function formatWait(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes >= 60) {
    const hours = Math.ceil(minutes / 60);
    return hours === 1 ? 'an hour' : `${hours} hours`;
  }
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

function fallMsAt(p: number): number {
  if (p <= 0.25) return lerp(FALL_MS_START, FALL_MS_QUARTER, p / 0.25);
  return lerp(FALL_MS_QUARTER, FALL_MS_END, (p - 0.25) / 0.75);
}

/**
 * Spawn gap aimed at ~1–3 candy corn in the catch band, without packing
 * the whole sky. Speed (fallMs) ramps independently.
 */
function spawnGapAt(p: number, fallMs: number, treatChance: number): number {
  const targetCandy = lerp(1.7, 2.4, p);
  const rawGap = (fallMs * CATCH_FRAC * treatChance) / targetCandy;
  const maxOnScreen = lerp(10, 13, p);
  return Math.max(rawGap, fallMs / maxOnScreen);
}

function generateTargets(): SpiritSnatchTarget[] {
  const targets: SpiritSnatchTarget[] = [];
  let t = 220;
  let id = 1;
  while (t < ROUND_MS - 800) {
    const p = t / ROUND_MS;
    const fallMs = fallMsAt(p);
    const treatChance = lerp(0.72, 0.58, p);
    targets.push({
      id: id++,
      kind: Math.random() < treatChance ? 'treat' : 'trick',
      xFrac: 0.06 + Math.random() * 0.88,
      spawnAt: Math.round(t),
      fallMs: Math.round(fallMs),
      driftFrac: (Math.random() - 0.5) * lerp(0.04, 0.14, p),
    });
    t += spawnGapAt(p, fallMs, treatChance);
  }
  return targets;
}

function scoreTaps(
  targets: SpiritSnatchTarget[],
  taps: SpiritSnatchTap[],
  elapsedMs: number,
): number {
  const byId = new Map(targets.map((tgt) => [tgt.id, tgt]));
  const used = new Set<number>();
  let score = 0;

  for (const tap of taps.slice(0, MAX_TAPS)) {
    const id = Math.floor(Number(tap.id));
    const atMs = Number(tap.atMs);
    if (!Number.isFinite(atMs) || atMs < 0 || atMs > elapsedMs + TAP_SLACK_MS) continue;
    const tgt = byId.get(id);
    if (!tgt || used.has(id)) continue;

    const windowStart = tgt.spawnAt + tgt.fallMs * CATCH_START - TAP_SLACK_MS;
    const windowEnd = tgt.spawnAt + tgt.fallMs * CATCH_END + TAP_SLACK_MS;
    if (atMs < windowStart || atMs > windowEnd) continue;

    used.add(id);
    if (tgt.kind === 'treat') score += 1;
    else score = Math.max(0, score - TRICK_PENALTY);
  }

  const treatCap = targets.filter((tgt) => tgt.kind === 'treat').length;
  return Math.min(score, treatCap);
}

function toClientRound(round: {
  roundId: string;
  targets: SpiritSnatchTarget[];
}): SpiritSnatchRound {
  return {
    roundId: round.roundId,
    roundMs: ROUND_MS,
    catchStart: CATCH_START,
    catchEnd: CATCH_END,
    targets: round.targets,
  };
}

function nextAvailableAt(lastAt: Date): Date {
  return new Date(lastAt.getTime() + COOLDOWN_MS);
}

/**
 * Starts a Spirit Snatch round. Consumes the hourly attempt up front.
 * An in-progress round can be resumed until it expires.
 */
export async function startSpiritSnatch(userId: string): Promise<SpiritSnatchStartResult> {
  const farm = await Farm.findOne({ userId });
  if (!farm) throw new Error('Farm not found');

  const now = Date.now();
  const existing = farm.spiritSnatchRound;
  if (existing?.startedAt && existing.targets?.length) {
    const expires = existing.startedAt.getTime() + ROUND_MS + ROUND_GRACE_MS;
    if (now < expires) {
      return { ok: true, round: toClientRound(existing) };
    }
  }

  const lastAt = farm.lastSpiritSnatchAt;
  if (lastAt) {
    const next = nextAvailableAt(lastAt);
    if (now < next.getTime()) {
      return {
        ok: false,
        onCooldown: true,
        nextAvailableAt: next.toISOString(),
        message: `The kettle is still bubbling. Come back in ${formatWait(next.getTime() - now)}.`,
      };
    }
  }

  const round = {
    roundId: randomUUID(),
    startedAt: new Date(now),
    targets: generateTargets(),
  };
  farm.spiritSnatchRound = round;
  farm.lastSpiritSnatchAt = new Date(now);
  farm.markModified('spiritSnatchRound');
  await farm.save();

  log.info({ userId, roundId: round.roundId, targets: round.targets.length }, 'Spirit Snatch started');
  return { ok: true, round: toClientRound(round) };
}

/**
 * Scores a finished round from the stored spawn list. Client taps are checked
 * against catch-zone timing; the reported score is ignored.
 */
export async function submitSpiritSnatch(
  userId: string,
  roundId: string,
  taps: SpiritSnatchTap[],
): Promise<{ result: SpiritSnatchResult; stateUpdate: StateUpdate }> {
  const farm = await Farm.findOne({ userId });
  if (!farm) throw new Error('Farm not found');

  const round = farm.spiritSnatchRound;
  if (!round?.roundId || round.roundId !== roundId || !round.targets?.length) {
    throw new Error('That snatch already finished.');
  }

  const elapsedMs = Date.now() - round.startedAt.getTime();
  if (elapsedMs > ROUND_MS + ROUND_GRACE_MS) {
    farm.spiritSnatchRound = undefined;
    farm.markModified('spiritSnatchRound');
    await farm.save();
    throw new Error('Too slow — the spirits got away.');
  }

  const score = scoreTaps(round.targets, Array.isArray(taps) ? taps : [], elapsedMs);
  const candyAwarded = Math.min(MAX_CANDY_PER_ROUND, Math.floor(score / 2));

  farm.spiritSnatchRound = undefined;
  farm.markModified('spiritSnatchRound');
  if (candyAwarded > 0) {
    farm.inventory.set(CANDY_ITEM, (farm.inventory.get(CANDY_ITEM) ?? 0) + candyAwarded);
    farm.markModified('inventory');
  }
  await farm.save();

  const sync = score > 0
    ? await questService.recordEvents(userId, {
      kind: 'action',
      action: 'spirit_snatch',
      count: score,
    })
    : await questService.sync(userId);

  const socialXp = Math.min(40, SKILL_XP_REWARDS.spirit_snatch + score);
  const skillGrant = await skillXpService.grant(userId, 'social', socialXp);

  log.info({ userId, roundId, score, candyAwarded, socialXp, taps: taps?.length ?? 0 }, 'Spirit Snatch scored');

  return {
    result: { score, candyAwarded },
    stateUpdate: attachSkillXp(
      withQuestSync(
        { inventory: inventoryRecord(farm), gems: farm.gems ?? 0 },
        sync,
      ),
      skillGrant,
    ),
  };
}

/** Admin: clear hourly cooldown and any in-progress round. */
export async function resetSpiritSnatchCooldown(userId: string): Promise<void> {
  const result = await Farm.updateOne(
    { userId },
    { $unset: { lastSpiritSnatchAt: 1, spiritSnatchRound: 1 } },
  );
  if (result.matchedCount === 0) throw new Error('Farm not found');
  log.info({ userId }, 'Spirit Snatch cooldown reset');
}
