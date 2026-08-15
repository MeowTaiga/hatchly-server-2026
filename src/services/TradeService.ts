/**
 * Server-authoritative multiplayer trading.
 *
 * Security model:
 * - Offered items are immediately removed from inventory (escrow) so they cannot
 *   be double-spent via shop/cook/place while the trade is open.
 * - Completing a trade transfers escrow to the other player; cancel returns it.
 * - Never trusts client inventory totals — always reloads Farm from DB.
 * - Both parties must be in the same SceneInstance.
 * - Per-trade async mutex prevents concurrent mutating races on one session.
 */

import crypto from 'crypto';
import { Farm, type IFarm } from '../models/Farm.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { User } from '../models/User.js';
import { multiplayerManager } from './MultiplayerManager.js';
import { inventoryToRecord } from '../utils/recipeUtils.js';
import { createLogger } from '../config/logger.js';
import { emitToUser } from '../websocket/index.js';
import { WS_EVENTS } from '../websocket/events.js';
import { isStressBot } from './stressBotIds.js';

const log = createLogger('TradeService');

/** In-memory inventories for stress-test bots (no Farm documents). */
const botInventories = new Map<string, Map<string, number>>();

const PENDING_TTL_MS = 45_000;
const OPEN_TTL_MS = 10 * 60_000;
const MAX_OFFER_STACKS = 24;
const MAX_QTY_PER_STACK = 999;

/** Categories allowed in trades (equip / buildings / scenery never tradable). */
const TRADABLE_CATEGORIES = new Set([
  'ingredient',
  'material',
  'food',
  'fish',
  'bug',
  'seed',
  'soil',
]);

export type TradeOfferItem = { itemType: string; qty: number };

export type TradeStatus = 'pending' | 'open' | 'completing';

export interface TradeParticipantPublic {
  userId: string;
  username: string;
  petName: string;
  petImageUrl: string;
}

export interface TradeStateSnapshot {
  tradeId: string;
  status: TradeStatus;
  version: number;
  youUserId: string;
  partner: TradeParticipantPublic;
  yourOffer: TradeOfferItem[];
  theirOffer: TradeOfferItem[];
  youReady: boolean;
  theyReady: boolean;
}

interface TradeSession {
  tradeId: string;
  instanceId: string;
  initiatorUserId: string;
  recipientUserId: string;
  status: TradeStatus;
  /** Escrowed offers — already removed from each player's inventory. */
  offers: Record<string, TradeOfferItem[]>;
  ready: Record<string, boolean>;
  version: number;
  createdAt: number;
  expiresAt: number;
  participants: Record<string, TradeParticipantPublic>;
}

const sessions = new Map<string, TradeSession>();
const userTrade = new Map<string, string>();
const locks = new Map<string, Promise<void>>();

function genId(): string {
  return crypto.randomBytes(12).toString('hex');
}

async function withTradeLock<T>(tradeId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(tradeId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  locks.set(
    tradeId,
    prev.then(() => gate),
  );
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(tradeId) === gate) locks.delete(tradeId);
  }
}

function otherUser(session: TradeSession, userId: string): string {
  return session.initiatorUserId === userId
    ? session.recipientUserId
    : session.initiatorUserId;
}

function normalizeOffer(items: TradeOfferItem[]): TradeOfferItem[] {
  const merged = new Map<string, number>();
  for (const raw of items) {
    if (!raw || typeof raw.itemType !== 'string') continue;
    const itemType = raw.itemType.trim();
    const qty = Math.floor(Number(raw.qty));
    if (!itemType || !Number.isFinite(qty) || qty <= 0) continue;
    merged.set(itemType, Math.min(MAX_QTY_PER_STACK, (merged.get(itemType) ?? 0) + qty));
  }
  const out: TradeOfferItem[] = [];
  for (const [itemType, qty] of merged) out.push({ itemType, qty });
  out.sort((a, b) => a.itemType.localeCompare(b.itemType));
  if (out.length > MAX_OFFER_STACKS) {
    throw new Error(`You can offer at most ${MAX_OFFER_STACKS} item stacks`);
  }
  return out;
}

function offerMap(items: TradeOfferItem[]): Map<string, number> {
  return new Map(items.map((i) => [i.itemType, i.qty]));
}

/** Diff: how much to take from inventory (+) or return to inventory (-). */
function offerDelta(
  prev: TradeOfferItem[],
  next: TradeOfferItem[],
): { take: TradeOfferItem[]; giveBack: TradeOfferItem[] } {
  const a = offerMap(prev);
  const b = offerMap(next);
  const take: TradeOfferItem[] = [];
  const giveBack: TradeOfferItem[] = [];
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    const d = (b.get(k) ?? 0) - (a.get(k) ?? 0);
    if (d > 0) take.push({ itemType: k, qty: d });
    else if (d < 0) giveBack.push({ itemType: k, qty: -d });
  }
  return { take, giveBack };
}

async function assertTradable(items: TradeOfferItem[]): Promise<void> {
  if (items.length === 0) return;
  const types = items.map((i) => i.itemType);
  const defs = await GameItemDef.find({ itemType: { $in: types } }).lean();
  const byType = new Map(defs.map((d) => [d.itemType, d]));
  for (const { itemType } of items) {
    const def = byType.get(itemType);
    if (!def) throw new Error(`Unknown item: ${itemType}`);
    const ok = def.sellable === true || TRADABLE_CATEGORIES.has(def.category);
    if (!ok) throw new Error(`${def.label ?? itemType} cannot be traded`);
  }
}

function clearEquippedIfMissing(farm: IFarm, itemType: string): void {
  const eq = farm.equipped;
  if (!eq) return;
  let dirty = false;
  if (eq.handTool === itemType && (farm.inventory.get(itemType) ?? 0) <= 0) {
    eq.handTool = undefined;
    dirty = true;
  }
  if (eq.bobber === itemType && (farm.inventory.get(itemType) ?? 0) <= 0) {
    eq.bobber = undefined;
    dirty = true;
  }
  if (eq.bait === itemType && (farm.inventory.get(itemType) ?? 0) <= 0) {
    eq.bait = undefined;
    dirty = true;
  }
  if (eq.chair === itemType && (farm.inventory.get(itemType) ?? 0) <= 0) {
    eq.chair = undefined;
    dirty = true;
  }
  if (dirty) farm.markModified('equipped');
}

function botInvRecord(userId: string): Record<string, number> {
  const inv = botInventories.get(userId) ?? new Map();
  return Object.fromEntries(inv.entries());
}

async function takeItems(userId: string, items: TradeOfferItem[]): Promise<Record<string, number>> {
  if (isStressBot(userId)) {
    let inv = botInventories.get(userId);
    if (!inv) {
      inv = new Map();
      botInventories.set(userId, inv);
    }
    for (const { itemType, qty } of items) {
      const have = inv.get(itemType) ?? 0;
      if (have < qty) throw new Error(`Not enough items to offer (${itemType})`);
    }
    for (const { itemType, qty } of items) {
      const have = inv.get(itemType) ?? 0;
      const next = have - qty;
      if (next <= 0) inv.delete(itemType);
      else inv.set(itemType, next);
    }
    return botInvRecord(userId);
  }

  if (items.length === 0) {
    const farm = await Farm.findOne({ userId });
    if (!farm) throw new Error('Farm not found');
    return inventoryToRecord(farm.inventory);
  }
  const farm = await Farm.findOne({ userId });
  if (!farm) throw new Error('Farm not found');

  for (const { itemType, qty } of items) {
    const have = farm.inventory.get(itemType) ?? 0;
    if (have < qty) {
      throw new Error(`Not enough items to offer (${itemType})`);
    }
  }
  for (const { itemType, qty } of items) {
    const have = farm.inventory.get(itemType) ?? 0;
    const next = have - qty;
    if (next <= 0) farm.inventory.delete(itemType);
    else farm.inventory.set(itemType, next);
    clearEquippedIfMissing(farm, itemType);
  }
  farm.markModified('inventory');
  await farm.save();
  return inventoryToRecord(farm.inventory);
}

async function giveItems(userId: string, items: TradeOfferItem[]): Promise<Record<string, number>> {
  if (isStressBot(userId)) {
    let inv = botInventories.get(userId);
    if (!inv) {
      inv = new Map();
      botInventories.set(userId, inv);
    }
    for (const { itemType, qty } of items) {
      if (qty <= 0) continue;
      inv.set(itemType, (inv.get(itemType) ?? 0) + qty);
    }
    return botInvRecord(userId);
  }

  const farm = await Farm.findOne({ userId });
  if (!farm) throw new Error('Farm not found');
  for (const { itemType, qty } of items) {
    if (qty <= 0) continue;
    farm.inventory.set(itemType, (farm.inventory.get(itemType) ?? 0) + qty);
  }
  farm.markModified('inventory');
  await farm.save();
  return inventoryToRecord(farm.inventory);
}

async function loadParticipant(userId: string): Promise<TradeParticipantPublic> {
  if (isStressBot(userId)) {
    const inst = multiplayerManager.getInstanceForUser(userId);
    const player = inst?.getPlayer(userId);
    if (!player) throw new Error('Player not found nearby');
    return {
      userId,
      username: player.username ?? 'Bot',
      petName: player.petName ?? 'Pet',
      petImageUrl: player.petImageUrl ?? '',
    };
  }

  const user = await User.findById(userId).select('username pet').lean();
  if (!user) throw new Error('User not found');
  return {
    userId,
    username: user.username ?? 'Anon',
    petName: user.pet?.customName ?? user.pet?.name ?? 'Pet',
    petImageUrl: user.pet?.imageUrl ?? '',
  };
}

function emitSnapshotsToHumans(tradeId: string, event: string = WS_EVENTS.MP_TRADE_STATE): void {
  const session = sessions.get(tradeId);
  if (!session) return;
  for (const uid of [session.initiatorUserId, session.recipientUserId]) {
    if (isStressBot(uid)) continue;
    const snap = toSnapshot(session, uid);
    emitToUser(uid, event, snap);
  }
}

function pickBotOffer(botId: string): TradeOfferItem[] {
  const inv = botInventories.get(botId);
  if (!inv || inv.size === 0) return [];
  const stacks = [...inv.entries()].filter(([, q]) => q > 0);
  if (stacks.length === 0) return [];
  // Shuffle lightly and offer 1–3 stacks (half of held qty, at least 1).
  for (let i = stacks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [stacks[i], stacks[j]] = [stacks[j], stacks[i]];
  }
  const n = Math.min(stacks.length, 1 + Math.floor(Math.random() * 3));
  const offer: TradeOfferItem[] = [];
  for (let i = 0; i < n; i++) {
    const [itemType, qty] = stacks[i];
    const give = Math.max(1, Math.floor(qty * (0.35 + Math.random() * 0.45)));
    offer.push({ itemType, qty: Math.min(qty, give) });
  }
  return offer;
}

/** After a human requests a trade with a bot: 50/50 accept (then offer) or decline. */
function scheduleBotTradeResponse(tradeId: string, botUserId: string): void {
  const respondDelay = 450 + Math.floor(Math.random() * 700);
  setTimeout(() => {
    void (async () => {
      const session = sessions.get(tradeId);
      if (!session || session.status !== 'pending') return;

      // Coin flip — decline notifies the human initiator (same as mp:trade_declined).
      if (Math.random() < 0.5) {
        try {
          const result = await tradeService.declineTrade(botUserId, tradeId);
          if (!isStressBot(result.initiatorUserId)) {
            emitToUser(result.initiatorUserId, WS_EVENTS.MP_TRADE_DECLINED, {
              tradeId,
              byUserId: botUserId,
            });
          }
        } catch (err: any) {
          log.warn({ tradeId, botUserId, err: err.message }, 'Bot trade decline failed');
        }
        return;
      }

      try {
        await tradeService.acceptTrade(botUserId, tradeId);
        emitSnapshotsToHumans(tradeId, WS_EVENTS.MP_TRADE_OPEN);

        const offerDelay = 500 + Math.floor(Math.random() * 900);
        setTimeout(() => {
          void (async () => {
            try {
              if (!sessions.get(tradeId) || sessions.get(tradeId)?.status !== 'open') return;
              const items = pickBotOffer(botUserId);
              if (items.length === 0) return;
              await tradeService.updateOffer(botUserId, tradeId, items);
              emitSnapshotsToHumans(tradeId, WS_EVENTS.MP_TRADE_STATE);
            } catch (err: any) {
              log.warn({ tradeId, botUserId, err: err.message }, 'Bot trade offer failed');
            }
          })();
        }, offerDelay);
      } catch (err: any) {
        log.warn({ tradeId, botUserId, err: err.message }, 'Bot trade accept failed');
      }
    })();
  }, respondDelay);
}

/** When a human confirms and the bot is still waiting, auto-confirm. */
function scheduleBotConfirm(tradeId: string, botUserId: string, version: number): void {
  const delay = 350 + Math.floor(Math.random() * 650);
  setTimeout(() => {
    void (async () => {
      try {
        let result = await tradeService.confirm(botUserId, tradeId, version);
        if (result.kind === 'waiting') {
          const s = sessions.get(tradeId);
          if (!s || s.status !== 'open') return;
          result = await tradeService.confirm(botUserId, tradeId, s.version);
        }
        if (result.kind !== 'completed') return;
        const { session, inventories } = result;
        for (const uid of [session.initiatorUserId, session.recipientUserId]) {
          if (isStressBot(uid)) continue;
          const inv = inventories[uid];
          if (inv) emitToUser(uid, WS_EVENTS.GAME_STATE_UPDATE, { inventory: inv });
          emitToUser(uid, WS_EVENTS.MP_TRADE_COMPLETE, {
            tradeId,
            partnerUserId:
              uid === session.initiatorUserId
                ? session.recipientUserId
                : session.initiatorUserId,
          });
        }
      } catch (err: any) {
        // Version drift — retry once against current open session.
        const s = sessions.get(tradeId);
        if (!s || s.status !== 'open' || !s.ready[otherUser(s, botUserId)]) {
          log.warn({ tradeId, botUserId, err: err.message }, 'Bot trade confirm failed');
          return;
        }
        try {
          const result = await tradeService.confirm(botUserId, tradeId, s.version);
          if (result.kind !== 'completed') return;
          const { session, inventories } = result;
          for (const uid of [session.initiatorUserId, session.recipientUserId]) {
            if (isStressBot(uid)) continue;
            const inv = inventories[uid];
            if (inv) emitToUser(uid, WS_EVENTS.GAME_STATE_UPDATE, { inventory: inv });
            emitToUser(uid, WS_EVENTS.MP_TRADE_COMPLETE, {
              tradeId,
              partnerUserId:
                uid === session.initiatorUserId
                  ? session.recipientUserId
                  : session.initiatorUserId,
            });
          }
        } catch (err2: any) {
          log.warn({ tradeId, botUserId, err: err2.message }, 'Bot trade confirm retry failed');
        }
      }
    })();
  }, delay);
}

function toSnapshot(session: TradeSession, viewerId: string): TradeStateSnapshot {
  const partnerId = otherUser(session, viewerId);
  return {
    tradeId: session.tradeId,
    status: session.status,
    version: session.version,
    youUserId: viewerId,
    partner: session.participants[partnerId],
    yourOffer: session.offers[viewerId] ?? [],
    theirOffer: session.offers[partnerId] ?? [],
    youReady: !!session.ready[viewerId],
    theyReady: !!session.ready[partnerId],
  };
}

async function returnEscrow(session: TradeSession, userId: string): Promise<Record<string, number> | null> {
  const offer = session.offers[userId] ?? [];
  session.offers[userId] = [];
  if (offer.length === 0) return null;
  try {
    return await giveItems(userId, offer);
  } catch (err: any) {
    log.error({ userId, tradeId: session.tradeId, err: err.message }, 'Failed to return escrow');
    return null;
  }
}

function detachSession(session: TradeSession): void {
  sessions.delete(session.tradeId);
  userTrade.delete(session.initiatorUserId);
  userTrade.delete(session.recipientUserId);
}

/** Caller must already hold the trade lock (or own the only reference). */
async function cancelUnlocked(
  session: TradeSession,
): Promise<{
  initiatorUserId: string;
  recipientUserId: string;
  inventories: Record<string, Record<string, number> | null>;
}> {
  const inventories: Record<string, Record<string, number> | null> = {};
  inventories[session.initiatorUserId] = await returnEscrow(session, session.initiatorUserId);
  inventories[session.recipientUserId] = await returnEscrow(session, session.recipientUserId);
  const initiatorUserId = session.initiatorUserId;
  const recipientUserId = session.recipientUserId;
  detachSession(session);
  return { initiatorUserId, recipientUserId, inventories };
}

async function expirePendingAndNotify(tradeId: string): Promise<void> {
  const result = await withTradeLock(tradeId, async () => {
    const session = sessions.get(tradeId);
    if (!session || session.status !== 'pending') return null;
    if (Date.now() < session.expiresAt) return null;
    log.info({ tradeId }, 'Trade request expired');
    return cancelUnlocked(session);
  });
  if (!result) return;
  emitToUser(result.initiatorUserId, WS_EVENTS.MP_TRADE_CANCELLED, {
    tradeId,
    reason: 'Trade request expired',
  });
  emitToUser(result.recipientUserId, WS_EVENTS.MP_TRADE_CANCELLED, {
    tradeId,
    reason: 'Trade request expired',
  });
}

export const tradeService = {
  getSession(tradeId: string): TradeSession | undefined {
    return sessions.get(tradeId);
  },

  getTradeIdForUser(userId: string): string | undefined {
    return userTrade.get(userId);
  },

  snapshotFor(tradeId: string, viewerId: string): TradeStateSnapshot | null {
    const s = sessions.get(tradeId);
    if (!s) return null;
    if (s.initiatorUserId !== viewerId && s.recipientUserId !== viewerId) return null;
    return toSnapshot(s, viewerId);
  },

  async requestTrade(initiatorUserId: string, targetUserId: string): Promise<{
    tradeId: string;
    recipient: TradeParticipantPublic;
    initiator: TradeParticipantPublic;
  }> {
    if (!targetUserId || targetUserId === initiatorUserId) {
      throw new Error('Invalid trade target');
    }
    if (userTrade.has(initiatorUserId)) throw new Error('You are already in a trade');
    if (userTrade.has(targetUserId)) throw new Error('That player is already in a trade');

    const myInst = multiplayerManager.getInstanceForUser(initiatorUserId);
    const theirInst = multiplayerManager.getInstanceForUser(targetUserId);
    if (!myInst || !theirInst || myInst.instanceId !== theirInst.instanceId) {
      throw new Error('You must be in the same area to trade');
    }
    if (!myInst.getPlayer(targetUserId)) {
      throw new Error('Player not found nearby');
    }

    const [initiator, recipient] = await Promise.all([
      loadParticipant(initiatorUserId),
      loadParticipant(targetUserId),
    ]);

    const tradeId = genId();
    const session: TradeSession = {
      tradeId,
      instanceId: myInst.instanceId,
      initiatorUserId,
      recipientUserId: targetUserId,
      status: 'pending',
      offers: { [initiatorUserId]: [], [targetUserId]: [] },
      ready: { [initiatorUserId]: false, [targetUserId]: false },
      version: 1,
      createdAt: Date.now(),
      expiresAt: Date.now() + PENDING_TTL_MS,
      participants: {
        [initiatorUserId]: initiator,
        [targetUserId]: recipient,
      },
    };
    sessions.set(tradeId, session);
    userTrade.set(initiatorUserId, tradeId);
    userTrade.set(targetUserId, tradeId);

    setTimeout(() => {
      void expirePendingAndNotify(tradeId);
    }, PENDING_TTL_MS + 50);

    if (isStressBot(targetUserId) && !isStressBot(initiatorUserId)) {
      scheduleBotTradeResponse(tradeId, targetUserId);
    }

    log.info({ tradeId, initiatorUserId, targetUserId }, 'Trade requested');
    return { tradeId, recipient, initiator };
  },

  async acceptTrade(userId: string, tradeId: string): Promise<TradeSession> {
    return withTradeLock(tradeId, async () => {
      const session = sessions.get(tradeId);
      if (!session) throw new Error('Trade not found');
      if (session.recipientUserId !== userId) throw new Error('Only the recipient can accept');
      if (session.status !== 'pending') throw new Error('Trade is no longer pending');
      if (Date.now() > session.expiresAt) {
        await cancelUnlocked(session);
        throw new Error('Trade request expired');
      }

      const myInst = multiplayerManager.getInstanceForUser(userId);
      const theirInst = multiplayerManager.getInstanceForUser(session.initiatorUserId);
      if (!myInst || !theirInst || myInst.instanceId !== session.instanceId) {
        await cancelUnlocked(session);
        throw new Error('You must stay in the same area to trade');
      }

      session.status = 'open';
      session.expiresAt = Date.now() + OPEN_TTL_MS;
      session.version += 1;
      session.ready[session.initiatorUserId] = false;
      session.ready[session.recipientUserId] = false;
      log.info({ tradeId, userId }, 'Trade accepted');
      return session;
    });
  },

  async declineTrade(userId: string, tradeId: string): Promise<{
    initiatorUserId: string;
    recipientUserId: string;
  }> {
    return withTradeLock(tradeId, async () => {
      const session = sessions.get(tradeId);
      if (!session) throw new Error('Trade not found');
      if (session.recipientUserId !== userId && session.initiatorUserId !== userId) {
        throw new Error('Not part of this trade');
      }
      if (session.status !== 'pending') throw new Error('Trade is no longer pending');
      const initiatorUserId = session.initiatorUserId;
      const recipientUserId = session.recipientUserId;
      // Pending has no escrow yet.
      detachSession(session);
      log.info({ tradeId, userId }, 'Trade declined');
      return { initiatorUserId, recipientUserId };
    });
  },

  async updateOffer(
    userId: string,
    tradeId: string,
    items: TradeOfferItem[],
  ): Promise<{
    session: TradeSession;
    inventory: Record<string, number>;
  }> {
    return withTradeLock(tradeId, async () => {
      const session = sessions.get(tradeId);
      if (!session) throw new Error('Trade not found');
      if (session.initiatorUserId !== userId && session.recipientUserId !== userId) {
        throw new Error('Not part of this trade');
      }
      if (session.status !== 'open') throw new Error('Trade is not open');
      if (Date.now() > session.expiresAt) {
        await cancelUnlocked(session);
        throw new Error('Trade expired');
      }

      const next = normalizeOffer(items);
      await assertTradable(next);

      const prev = session.offers[userId] ?? [];
      const { take, giveBack } = offerDelta(prev, next);

      // Return first so the player can reshuffle stacks within the same update.
      if (giveBack.length) await giveItems(userId, giveBack);
      let inventory: Record<string, number>;
      try {
        inventory = await takeItems(userId, take);
      } catch (err) {
        // Roll back giveBack if take fails.
        if (giveBack.length) {
          try {
            await takeItems(userId, giveBack);
          } catch {
            /* best-effort */
          }
        }
        throw err;
      }

      session.offers[userId] = next;
      session.ready[session.initiatorUserId] = false;
      session.ready[session.recipientUserId] = false;
      session.version += 1;

      log.info({ tradeId, userId, stacks: next.length, version: session.version }, 'Trade offer updated');
      return { session, inventory };
    });
  },

  async confirm(
    userId: string,
    tradeId: string,
    clientVersion: number,
  ): Promise<
    | { kind: 'waiting'; session: TradeSession }
    | {
        kind: 'completed';
        session: TradeSession;
        inventories: Record<string, Record<string, number>>;
      }
  > {
    return withTradeLock(tradeId, async () => {
      const session = sessions.get(tradeId);
      if (!session) throw new Error('Trade not found');
      if (session.initiatorUserId !== userId && session.recipientUserId !== userId) {
        throw new Error('Not part of this trade');
      }
      if (session.status !== 'open') throw new Error('Trade is not open');
      if (clientVersion !== session.version) {
        throw new Error('Trade changed — confirm again');
      }

      session.ready[userId] = true;
      session.version += 1;

      const a = session.initiatorUserId;
      const b = session.recipientUserId;
      if (!session.ready[a] || !session.ready[b]) {
        const partner = otherUser(session, userId);
        if (isStressBot(partner) && !isStressBot(userId)) {
          scheduleBotConfirm(tradeId, partner, session.version);
        }
        return { kind: 'waiting' as const, session };
      }

      session.status = 'completing';
      const offerA = session.offers[a] ?? [];
      const offerB = session.offers[b] ?? [];

      // Escrow already held — grant each side the other's offer.
      // Fixed userId order for deterministic save ordering.
      const first = a < b ? a : b;
      const second = a < b ? b : a;
      const firstGets = first === a ? offerB : offerA;
      const secondGets = second === a ? offerB : offerA;

      const invFirst = await giveItems(first, firstGets);
      const invSecond = await giveItems(second, secondGets);

      session.offers[a] = [];
      session.offers[b] = [];
      detachSession(session);

      log.info({ tradeId, a, b }, 'Trade completed');
      return {
        kind: 'completed' as const,
        session,
        inventories: {
          [first]: invFirst,
          [second]: invSecond,
        },
      };
    });
  },

  async cancelTrade(
    tradeId: string,
    byUserId: string,
    _reason?: string,
  ): Promise<{
    initiatorUserId: string;
    recipientUserId: string;
    inventories: Record<string, Record<string, number> | null>;
  } | null> {
    return withTradeLock(tradeId, async () => {
      const session = sessions.get(tradeId);
      if (!session) return null;
      if (
        byUserId !== 'system' &&
        session.initiatorUserId !== byUserId &&
        session.recipientUserId !== byUserId
      ) {
        throw new Error('Not part of this trade');
      }
      if (session.status === 'completing') return null;

      log.info({ tradeId, byUserId }, 'Trade cancelled');
      return cancelUnlocked(session);
    });
  },

  /** Cancel any trade involving this user (leave scene / disconnect). */
  async cancelForUser(userId: string): Promise<{
    tradeId: string;
    initiatorUserId: string;
    recipientUserId: string;
    inventories: Record<string, Record<string, number> | null>;
  } | null> {
    const tradeId = userTrade.get(userId);
    if (!tradeId) return null;
    const result = await this.cancelTrade(tradeId, 'system', 'Player left');
    if (!result) return null;
    return { tradeId, ...result };
  },

  /** Seed a virtual inventory for a stress-test bot. */
  async seedBotInventory(botId: string): Promise<void> {
    if (!isStressBot(botId)) return;
    try {
      const defs = await GameItemDef.aggregate<{ itemType: string }>([
        {
          $match: {
            $or: [
              { sellable: true },
              { category: { $in: [...TRADABLE_CATEGORIES] } },
            ],
            itemType: { $type: 'string', $ne: '' },
          },
        },
        { $sample: { size: 24 } },
        { $project: { itemType: 1, _id: 0 } },
      ]);
      const inv = new Map<string, number>();
      const picks = defs.slice(0, 6 + Math.floor(Math.random() * 5));
      for (const d of picks) {
        if (!d.itemType) continue;
        inv.set(d.itemType, 2 + Math.floor(Math.random() * 14));
      }
      if (inv.size === 0) {
        const any = await GameItemDef.findOne({
          $or: [{ sellable: true }, { category: { $in: [...TRADABLE_CATEGORIES] } }],
        })
          .select('itemType')
          .lean();
        if (any?.itemType) inv.set(any.itemType, 8);
      }
      botInventories.set(botId, inv);
    } catch (err: any) {
      log.warn({ botId, err: err.message }, 'Failed to seed bot inventory');
      botInventories.set(botId, new Map());
    }
  },

  clearBotInventory(botId: string): void {
    botInventories.delete(botId);
  },
};
