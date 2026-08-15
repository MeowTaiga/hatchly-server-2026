import { QuestDef, type IDialogStep, type IQuestDef, type IQuestReward } from '../../models/QuestDef.js';
import { UserQuest, type IUserQuest } from '../../models/UserQuest.js';
import { UserProgress } from '../../models/UserProgress.js';
import { Farm, type IFarm } from '../../models/Farm.js';
import { User } from '../../models/User.js';
import { GameItemDef } from '../../models/GameItemDef.js';
import { createLogger } from '../../config/logger.js';
import {
  actionKey,
  clausesMet,
  evaluateRequirements,
  type RequirementClause,
} from './requirements.js';
import { gatesPass, matchesEvent, shouldOpen, type AvailabilityContext } from './availability.js';
import {
  applyCompletionToFarm,
  completesAutomatically,
  grantQuestRecipes,
  type QuestCompletion,
} from './completion.js';

const log = createLogger('QuestService');

// ─── Public payload types ────────────────────────────────────────────────────

export interface QuestPayload {
  questId: string;
  type: string;
  title: string;
  description: string;
  status: 'locked' | 'active' | 'completed';
  /** For upgrade quests: the level this raises the farm to. */
  farmLevel?: number;
  /** The checklist, already resolved against the player's state. */
  clauses: RequirementClause[];
  rewards: IQuestReward;
  /**
   * Ready to finish: full checklist met, or only an NPC talk turn-in remains
   * (closed-book bubble). Open-book quests stay false until then.
   */
  canComplete: boolean;
  startDialog?: IDialogStep[];
  endDialog?: IDialogStep[];
  startDialogSpeaker?: 'pet' | 'npc';
  endDialogSpeaker?: 'pet' | 'npc';
  startDialogShown: boolean;
  /** NPC this quest is attached to (talk trigger or talk requirement), for bubbles. */
  npcItemType?: string;
  /**
   * True when a locked quest's level and prerequisite gates already pass, so it
   * is only waiting on its trigger. The app needs this to tell "come talk to me"
   * apart from "not for you yet" without re-implementing the gate rules.
   */
  gatesPass: boolean;
  sortOrder: number;
}

/** A dialog the app should present, with everything needed to render the speaker. */
export interface QuestDialog {
  /** Empty for idle NPC chatter, which belongs to no quest. */
  questId: string;
  kind: 'start' | 'end' | 'idle' | 'progress';
  steps: IDialogStep[];
  speaker?: 'pet' | 'npc';
  npcItemType?: string;
}

/**
 * The single shape every quest-touching call returns. Call sites merge this
 * into their state update instead of making four separate service calls and
 * hand-assembling the result, which is how the old code drifted apart.
 */
export interface QuestSync {
  quests: QuestPayload[];
  canUpgrade: boolean;
  farmLevel: number;
  /** True when a completion changed the farm, meaning the fields below are fresh. */
  farmChanged: boolean;
  inventory?: Record<string, number>;
  gems?: number;
  farmXp?: number;
  completed: QuestCompletion[];
  dialogs: QuestDialog[];
  newFarmLevel?: number;
  /** Placed items removed because a quest finished (NPC leaving the farm). */
  removedItemIds?: string[];
}

export type QuestEvent =
  | { kind: 'action'; action: string; itemType?: string; count?: number }
  | { kind: 'npc_talk'; npcItemType: string }
  | { kind: 'crop_grown'; itemType: string; count?: number }
  | { kind: 'modal_open'; payload: string };

// ─── Item label cache ────────────────────────────────────────────────────────

let labelCache: { at: number; labels: Map<string, string> } | null = null;
const LABEL_TTL_MS = 60_000;

async function itemLabels(): Promise<Map<string, string>> {
  if (labelCache && Date.now() - labelCache.at < LABEL_TTL_MS) return labelCache.labels;
  const defs = await GameItemDef.find({}, { itemType: 1, label: 1 }).lean();
  const labels = new Map(defs.map((d) => [d.itemType, d.label]));
  labelCache = { at: Date.now(), labels };
  return labels;
}

/** Called by the admin routes so a renamed item shows up in checklists immediately. */
export function invalidateItemLabelCache(): void {
  labelCache = null;
}

// ─── Internal state loading ──────────────────────────────────────────────────

interface QuestState {
  defs: IQuestDef[];
  rows: Map<string, IUserQuest>;
  farm: IFarm;
  ctx: AvailabilityContext;
  labels: Map<string, string>;
}

async function loadState(userId: string): Promise<QuestState> {
  const [defs, rows, farm, user, labels] = await Promise.all([
    QuestDef.find().sort({ sortOrder: 1 }),
    UserQuest.find({ userId }),
    Farm.findOne({ userId }),
    User.findById(userId, { pet: 1 }).lean(),
    itemLabels(),
  ]);

  if (!farm) throw new Error('Farm not found');

  const rowMap = new Map(rows.map((r) => [r.questId, r]));
  const completedQuestIds = new Set(
    rows.filter((r) => r.status === 'completed').map((r) => r.questId),
  );

  return {
    defs,
    rows: rowMap,
    farm,
    labels,
    ctx: {
      petLevel: user?.pet?.level ?? 1,
      farmLevel: farm.farmLevel ?? 1,
      completedQuestIds,
    },
  };
}

/** Creates the row for a quest the player has never seen. */
async function createRow(userId: string, questId: string, status: 'locked' | 'active'): Promise<IUserQuest> {
  return UserQuest.create({ userId, questId, status, progress: { actions: new Map() } });
}

// ─── Opening quests ──────────────────────────────────────────────────────────

/**
 * Brings every quest row in line with the availability rules: creates missing
 * rows and opens any locked quest whose conditions now pass.
 *
 * This runs on every read, which is what makes the system self-healing. The old
 * code decided a quest's status once, when its row was first created, so
 * finishing a prerequisite later left the dependent quest locked forever.
 */
async function openEligible(userId: string, state: QuestState): Promise<IQuestDef[]> {
  const opened: IQuestDef[] = [];

  for (const def of state.defs) {
    const row = state.rows.get(def.questId);

    if (!row) {
      const status = shouldOpen(def, state.ctx) ? 'active' : 'locked';
      const created = await createRow(userId, def.questId, status);
      state.rows.set(def.questId, created);
      if (status === 'active') opened.push(def);
      continue;
    }

    if (row.status === 'locked' && shouldOpen(def, state.ctx)) {
      row.status = 'active';
      await row.save();
      opened.push(def);
    }
  }

  return opened;
}

// ─── Recording progress ──────────────────────────────────────────────────────

/**
 * Tallies events against active quests. One pass over the player's active
 * quests handles every event kind, replacing four near-identical tracker
 * methods that each re-queried the database.
 */
async function applyEvents(state: QuestState, events: QuestEvent[]): Promise<boolean> {
  if (events.length === 0) return false;

  const defsById = new Map(state.defs.map((d) => [d.questId, d]));
  let changed = false;

  for (const row of state.rows.values()) {
    if (row.status !== 'active') continue;
    const req = defsById.get(row.questId)?.requirements;
    if (!req) continue;

    let rowChanged = false;

    for (const event of events) {
      switch (event.kind) {
        case 'action': {
          for (const wanted of req.actions ?? []) {
            if (wanted.action !== event.action) continue;
            if (wanted.itemType && wanted.itemType !== event.itemType) continue;
            const key = actionKey(event.action, wanted.itemType);
            row.progress.actions.set(key, (row.progress.actions.get(key) ?? 0) + (event.count ?? 1));
            row.markModified('progress.actions');
            rowChanged = true;
          }
          break;
        }
        case 'npc_talk': {
          if (!req.talk_to_npc?.some((r) => r.npcItemType === event.npcItemType)) break;
          if (!row.progress.npcTalks) row.progress.npcTalks = new Map();
          row.progress.npcTalks.set(event.npcItemType, (row.progress.npcTalks.get(event.npcItemType) ?? 0) + 1);
          row.markModified('progress.npcTalks');
          rowChanged = true;
          break;
        }
        case 'crop_grown': {
          if (!req.crop_grown?.some((r) => r.itemType === event.itemType)) break;
          if (!row.progress.cropsGrown) row.progress.cropsGrown = new Map();
          row.progress.cropsGrown.set(event.itemType, (row.progress.cropsGrown.get(event.itemType) ?? 0) + (event.count ?? 1));
          row.markModified('progress.cropsGrown');
          rowChanged = true;
          break;
        }
        case 'modal_open': {
          if (!req.open_modal?.some((r) => r.payload === event.payload)) break;
          if (!row.progress.modalsOpened) row.progress.modalsOpened = new Map();
          row.progress.modalsOpened.set(event.payload, (row.progress.modalsOpened.get(event.payload) ?? 0) + 1);
          row.markModified('progress.modalsOpened');
          rowChanged = true;
          break;
        }
      }
    }

    if (rowChanged) {
      await row.save();
      changed = true;
    }
  }

  return changed;
}

// ─── Completion ──────────────────────────────────────────────────────────────

/**
 * Marks a quest completed, but only if it is currently active. The guarded
 * update is what makes completion idempotent: a duplicated socket message
 * loses the race and returns null instead of granting rewards twice.
 */
async function claim(userId: string, questId: string): Promise<boolean> {
  const claimed = await UserQuest.findOneAndUpdate(
    { userId, questId, status: 'active' },
    { $set: { status: 'completed', completedAt: new Date() } },
  );
  return Boolean(claimed);
}

async function release(userId: string, questId: string): Promise<void> {
  await UserQuest.updateOne(
    { userId, questId, status: 'completed' },
    { $set: { status: 'active' }, $unset: { completedAt: '' } },
  );
}

const MAX_COMPLETION_PASSES = 10;

/**
 * Completes everything that is currently completable, then re-opens and tries
 * again — finishing one quest can unlock another that is itself already
 * satisfied. Bounded so malformed data can't spin here forever.
 */
async function settle(userId: string, state: QuestState): Promise<QuestCompletion[]> {
  const completions: QuestCompletion[] = [];
  const claimedIds: string[] = [];

  for (let pass = 0; pass < MAX_COMPLETION_PASSES; pass++) {
    await openEligible(userId, state);

    let completedThisPass = false;

    for (const def of state.defs) {
      const row = state.rows.get(def.questId);
      if (row?.status !== 'active') continue;
      if (!completesAutomatically(def)) continue;

      const clauses = evaluateRequirements(def.requirements, {
        farm: state.farm,
        userQuest: row,
        itemLabels: state.labels,
      });
      if (!clausesMet(clauses)) continue;

      if (!(await claim(userId, def.questId))) continue;
      claimedIds.push(def.questId);
      row.status = 'completed';
      state.ctx.completedQuestIds.add(def.questId);
      state.ctx.farmLevel = state.farm.farmLevel;

      const completion = applyCompletionToFarm(state.farm, def);
      await grantQuestRecipes(userId, def.rewards?.recipes);
      completions.push(completion);
      completedThisPass = true;
      log.info({ userId, questId: def.questId }, 'Quest auto-completed');
    }

    if (!completedThisPass) break;
  }

  if (completions.length > 0) {
    try {
      await state.farm.save();
    } catch (err) {
      // The rewards never landed, so the quests must not stay completed.
      for (const questId of claimedIds) await release(userId, questId);
      throw err;
    }
  }

  return completions;
}

// ─── Payload building ────────────────────────────────────────────────────────

/** NPC this quest hangs off — trigger first, else a talk requirement. */
function npcForQuest(def: IQuestDef): string | undefined {
  return (
    def.triggers?.find((t) => t.type === 'talk_to_npc')?.npcItemType ??
    def.requirements?.talk_to_npc?.[0]?.npcItemType
  );
}

function questInvolvesNpc(def: IQuestDef, npcItemType: string): boolean {
  if (def.triggers?.some((t) => t.type === 'talk_to_npc' && t.npcItemType === npcItemType)) {
    return true;
  }
  return def.requirements?.talk_to_npc?.some((r) => r.npcItemType === npcItemType) ?? false;
}

/**
 * True when every non-talk clause is done and the player still needs to talk to
 * this NPC to finish — the closed-book / turn-in state.
 */
function readyForNpcTurnIn(clauses: RequirementClause[], npcItemType: string): boolean {
  let needsTalk = false;
  for (const c of clauses) {
    if (c.kind === 'talk_to_npc' && c.itemType === npcItemType) {
      if (!c.met) needsTalk = true;
      continue;
    }
    if (!c.met) return false;
  }
  return needsTalk;
}

/** True when the checklist is done, or only an NPC talk turn-in remains. */
function canCompleteQuest(clauses: RequirementClause[]): boolean {
  if (clausesMet(clauses)) return true;
  const unmet = clauses.filter((c) => !c.met);
  return unmet.length > 0 && unmet.every((c) => c.kind === 'talk_to_npc');
}

/**
 * Open-book tap: remind the player what's left without advancing progress.
 * Prefers authored `progressDialog`; falls back to a checklist summary.
 */
function progressReminder(
  def: IQuestDef,
  clauses: RequirementClause[],
  npcItemType: string,
): QuestDialog {
  if (def.progressDialog?.length) {
    const speaker = def.progressDialogSpeaker ?? 'npc';
    return {
      questId: def.questId,
      kind: 'progress',
      steps: def.progressDialog,
      speaker,
      npcItemType: speaker === 'pet' ? undefined : npcItemType,
    };
  }

  const unmet = clauses.filter((c) => !c.met && c.kind !== 'talk_to_npc');
  const steps: IDialogStep[] = [
    { text: `Still working on "${def.title}"? Here's what's left to do:` },
  ];
  if (unmet.length === 0) {
    steps.push({ text: def.description });
  } else {
    for (const c of unmet) {
      const progress = c.need > 1 ? ` (${Math.min(c.have, c.need)}/${c.need})` : '';
      steps.push({ text: `${c.label}${progress}` });
    }
  }
  return {
    questId: def.questId,
    kind: 'progress',
    steps,
    speaker: 'npc',
    npcItemType,
  };
}

function buildPayload(state: QuestState): QuestPayload[] {
  return state.defs.map((def) => {
    const row = state.rows.get(def.questId) ?? null;
    const clauses = evaluateRequirements(def.requirements, {
      farm: state.farm,
      userQuest: row,
      itemLabels: state.labels,
    });
    const status = row?.status ?? 'locked';

    return {
      questId: def.questId,
      type: def.type,
      title: def.title,
      description: def.description,
      status,
      farmLevel: def.farmLevel,
      clauses,
      rewards: def.rewards ?? {},
      canComplete: status === 'active' && canCompleteQuest(clauses),
      startDialog: def.startDialog?.length ? def.startDialog : undefined,
      endDialog: def.endDialog?.length ? def.endDialog : undefined,
      startDialogSpeaker: def.startDialogSpeaker,
      endDialogSpeaker: def.endDialogSpeaker,
      startDialogShown: row?.startDialogShown ?? false,
      npcItemType: npcForQuest(def),
      gatesPass: gatesPass(def, state.ctx),
      sortOrder: def.sortOrder,
    };
  });
}

function inventoryRecord(farm: IFarm): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of farm.inventory) {
    if (value > 0) out[key] = value;
  }
  return out;
}

/** True when an upgrade quest for the next level is ready to be turned in. */
function computeCanUpgrade(quests: QuestPayload[], farmLevel: number): boolean {
  return quests.some(
    (q) => q.type === 'farm_upgrade' && q.farmLevel === farmLevel + 1 && q.canComplete,
  );
}

/** The NPC's own lines, shown when it has nothing quest-related to say. */
async function idleChatter(npcItemType: string): Promise<QuestDialog | null> {
  const def = await GameItemDef.findOne({ itemType: npcItemType }, { npcDialog: 1 }).lean();
  if (!def?.npcDialog?.length) return null;
  return { questId: '', kind: 'idle', steps: def.npcDialog, speaker: 'npc', npcItemType };
}

/** Hands over start dialogs the player hasn't seen, marking them shown. */
async function takeStartDialogs(userId: string, state: QuestState, onlyFor?: Set<string>): Promise<QuestDialog[]> {
  const dialogs: QuestDialog[] = [];

  for (const def of state.defs) {
    if (onlyFor && !onlyFor.has(def.questId)) continue;
    const row = state.rows.get(def.questId);
    if (row?.status !== 'active' || row.startDialogShown) continue;
    if (!def.startDialog?.length) continue;

    dialogs.push({
      questId: def.questId,
      kind: 'start',
      steps: def.startDialog,
      speaker: def.startDialogSpeaker,
      npcItemType: def.startDialogSpeaker === 'pet' ? undefined : npcForQuest(def),
    });

    row.startDialogShown = true;
    await row.save();
  }

  return dialogs;
}

function finish(state: QuestState, completions: QuestCompletion[], dialogs: QuestDialog[]): QuestSync {
  const quests = buildPayload(state);
  const farmLevel = state.farm.farmLevel;
  const removedItemIds = completions.flatMap((c) => c.removedItemIds ?? []);
  const farmChanged = completions.length > 0;

  const endDialogs = completions
    .filter((c) => c.endDialog?.length)
    .map<QuestDialog>((c) => {
      const def = state.defs.find((d) => d.questId === c.questId);
      return {
        questId: c.questId,
        kind: 'end',
        steps: c.endDialog!,
        speaker: c.endDialogSpeaker,
        npcItemType: c.endDialogSpeaker === 'pet' || !def ? undefined : npcForQuest(def),
      };
    });

  return {
    quests,
    canUpgrade: computeCanUpgrade(quests, farmLevel),
    farmLevel,
    farmChanged,
    inventory: farmChanged ? inventoryRecord(state.farm) : undefined,
    gems: farmChanged ? state.farm.gems : undefined,
    farmXp: farmChanged ? state.farm.xp : undefined,
    completed: completions,
    // Farewells first, then newly opened intros — otherwise "take these seeds"
    // can land after the next quest already asked you to plant them.
    dialogs: [...endDialogs, ...dialogs],
    newFarmLevel: completions.find((c) => c.newFarmLevel)?.newFarmLevel,
    removedItemIds: removedItemIds.length > 0 ? removedItemIds : undefined,
  };
}

// ─── Public service ──────────────────────────────────────────────────────────

export const questService = {
  /**
   * Reconciles a player's quests and returns the full picture. Safe to call on
   * any read; it creates missing rows, opens whatever now qualifies, and
   * finishes anything already satisfied.
   *
   * Callers holding a modified Farm document must save it first — this loads
   * its own copy.
   */
  async sync(userId: string): Promise<QuestSync> {
    const state = await loadState(userId);
    const completions = await settle(userId, state);
    const dialogs = await takeStartDialogs(userId, state);
    return finish(state, completions, dialogs);
  },

  /** Reports gameplay to the quest system. This is the only way progress is recorded. */
  async recordEvents(userId: string, ...events: QuestEvent[]): Promise<QuestSync> {
    const state = await loadState(userId);
    await applyEvents(state, events);
    const completions = await settle(userId, state);
    const dialogs = await takeStartDialogs(userId, state);
    return finish(state, completions, dialogs);
  },

  /**
   * Turns in a quest the player completed deliberately — in practice the
   * Upgrade Farm button. Idempotent: replaying it is a no-op rather than a
   * double reward or a thrown error.
   */
  async completeQuest(userId: string, questId: string): Promise<QuestSync> {
    const state = await loadState(userId);
    const def = state.defs.find((d) => d.questId === questId);
    if (!def) throw new Error('Quest not found');

    const row = state.rows.get(questId);
    const completions: QuestCompletion[] = [];

    if (row?.status === 'active') {
      const clauses = evaluateRequirements(def.requirements, {
        farm: state.farm,
        userQuest: row,
        itemLabels: state.labels,
      });
      if (!clausesMet(clauses)) throw new Error('Quest requirements not met');

      if (await claim(userId, questId)) {
        row.status = 'completed';
        state.ctx.completedQuestIds.add(questId);
        const completion = applyCompletionToFarm(state.farm, def);
        await grantQuestRecipes(userId, def.rewards?.recipes);
        completions.push(completion);

        try {
          await state.farm.save();
        } catch (err) {
          await release(userId, questId);
          throw err;
        }

        state.ctx.farmLevel = state.farm.farmLevel;
        log.info({ userId, questId, newFarmLevel: state.farm.farmLevel }, 'Quest completed');
      }
    }

    // Finishing this quest may open or satisfy others.
    const cascaded = await settle(userId, state);
    const dialogs = await takeStartDialogs(userId, state);
    return finish(state, [...completions, ...cascaded], dialogs);
  },

  /**
   * Talking to an NPC.
   *
   * - Light bulb: opens the waiting quest and plays its start dialog (the open
   *   tap does not also count as the talk requirement).
   * - Open book (active, not ready): reminds the player what's left — no
   *   progress is recorded.
   * - Closed book (ready for turn-in): records the talk and completes.
   * - Otherwise: idle NPC chatter so a tap is never silent.
   */
  async talkToNpc(userId: string, npcItemType: string): Promise<QuestSync> {
    const state = await loadState(userId);
    const openedThisCall = new Set<string>();

    for (const def of state.defs) {
      const row = state.rows.get(def.questId);
      if (row && row.status !== 'locked') continue;
      if (!matchesEvent(def, { type: 'talk_to_npc', npcItemType }, state.ctx)) continue;

      if (row) {
        row.status = 'active';
        await row.save();
      } else {
        state.rows.set(def.questId, await createRow(userId, def.questId, 'active'));
      }
      openedThisCall.add(def.questId);
      log.info({ userId, questId: def.questId, npcItemType }, 'Quest opened by NPC');
    }

    // Freshly opened quests get their intro; do not treat this tap as turn-in.
    if (openedThisCall.size > 0) {
      await applyEvents(state, [{ kind: 'npc_talk', npcItemType }]);

      // Opening a quest by tapping an NPC must not also satisfy its talk
      // requirement — otherwise meet-and-greet quests finish before the start
      // dialog can play. A second tap (after the intro) counts for real.
      for (const questId of openedThisCall) {
        const row = state.rows.get(questId);
        if (!row?.progress.npcTalks) continue;
        const cur = row.progress.npcTalks.get(npcItemType) ?? 0;
        if (cur <= 0) continue;
        if (cur <= 1) row.progress.npcTalks.delete(npcItemType);
        else row.progress.npcTalks.set(npcItemType, cur - 1);
        row.markModified('progress.npcTalks');
        await row.save();
      }

      const completions = await settle(userId, state);
      const dialogs = await takeStartDialogs(userId, state);
      dialogs.sort((a, b) => Number(b.npcItemType === npcItemType) - Number(a.npcItemType === npcItemType));
      return finish(state, completions, dialogs);
    }

    // Active quests that hang off this NPC (trigger or talk requirement).
    type NpcQuest = { def: IQuestDef; clauses: RequirementClause[] };
    let turnIn: NpcQuest | null = null;
    let inProgress: NpcQuest | null = null;

    for (const def of state.defs) {
      const row = state.rows.get(def.questId);
      if (row?.status !== 'active' || !questInvolvesNpc(def, npcItemType)) continue;

      const clauses = evaluateRequirements(def.requirements, {
        farm: state.farm,
        userQuest: row,
        itemLabels: state.labels,
      });

      if (readyForNpcTurnIn(clauses, npcItemType)) {
        if (!turnIn || def.sortOrder < turnIn.def.sortOrder) turnIn = { def, clauses };
        continue;
      }

      if (!clausesMet(clauses)) {
        if (!inProgress || def.sortOrder < inProgress.def.sortOrder) {
          inProgress = { def, clauses };
        }
      }
    }

    // Closed book: count the talk and let settle finish the quest.
    if (turnIn) {
      await applyEvents(state, [{ kind: 'npc_talk', npcItemType }]);
      const completions = await settle(userId, state);
      const dialogs = await takeStartDialogs(userId, state);
      dialogs.sort((a, b) => Number(b.npcItemType === npcItemType) - Number(a.npcItemType === npcItemType));
      return finish(state, completions, dialogs);
    }

    // Open book: remind only — do not advance talk counters.
    if (inProgress) {
      const row = state.rows.get(inProgress.def.questId);
      // Prefer the quest intro if it somehow never played.
      if (row && !row.startDialogShown && inProgress.def.startDialog?.length) {
        const dialogs = await takeStartDialogs(userId, state, new Set([inProgress.def.questId]));
        return finish(state, [], dialogs);
      }
      const reminder = progressReminder(inProgress.def, inProgress.clauses, npcItemType);
      return finish(state, [], [reminder]);
    }

    const sync = finish(state, [], []);
    const idle = await idleChatter(npcItemType);
    if (idle) sync.dialogs.push(idle);
    return sync;
  },

  /** Entering a scene, honouring first-visit-only triggers. */
  async enterScene(userId: string, sceneSlug: string): Promise<QuestSync> {
    const state = await loadState(userId);

    const progress = await UserProgress.findOne({ userId }).lean();
    const alreadyVisited = progress?.visitedScenes?.includes(sceneSlug) ?? false;

    for (const def of state.defs) {
      const row = state.rows.get(def.questId);
      if (row && row.status !== 'locked') continue;
      if (!matchesEvent(def, { type: 'enter_scene', sceneSlug, alreadyVisited }, state.ctx)) continue;

      if (row) {
        row.status = 'active';
        await row.save();
      } else {
        state.rows.set(def.questId, await createRow(userId, def.questId, 'active'));
      }
      log.info({ userId, questId: def.questId, sceneSlug }, 'Quest opened by scene');
    }

    await UserProgress.updateOne(
      { userId },
      { $addToSet: { visitedScenes: sceneSlug } },
      { upsert: true },
    );

    const completions = await settle(userId, state);
    const dialogs = await takeStartDialogs(userId, state);
    return finish(state, completions, dialogs);
  },

  /** Admin helper: wipes a player's quest state so the flow can be replayed. */
  async resetForUser(userId: string): Promise<number> {
    const result = await UserQuest.deleteMany({ userId });
    await UserProgress.deleteOne({ userId });
    return result.deletedCount ?? 0;
  },
};

export type { RequirementClause } from './requirements.js';
export type { QuestCompletion } from './completion.js';
