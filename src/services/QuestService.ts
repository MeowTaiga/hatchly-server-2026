import { QuestDef, type IQuestDef, type IQuestRequirement, type IQuestStep, type IDialogStep, type IQuestTrigger } from '../models/QuestDef.js';
import { UserQuest, type IUserQuest } from '../models/UserQuest.js';
import { UserProgress } from '../models/UserProgress.js';
import { Farm, type IFarm } from '../models/Farm.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('QuestService');

// ─── Public Types (sent to clients) ─────────────────────────────────────────

export interface QuestProgressPayload {
  questId: string;
  type: string;
  title: string;
  description: string;
  farmLevel?: number;
  /** Minimum pet level to activate. */
  petLevelMin?: number;
  /** Minimum farm level to activate. */
  farmLevelMin?: number;
  /** Quest that must be completed before this can be activated. */
  requiredQuestId?: string;
  /** Triggers for activation (e.g. talk_to_npc, enter_scene). */
  triggers?: IQuestTrigger[];
  requirements: IQuestRequirement;
  rewards: IQuestDef['rewards'];
  status: 'locked' | 'active' | 'completed';
  progress: {
    actions: Record<string, number>;
    buildings: Record<string, number>;
    items: Record<string, number>;
    npcTalks?: Record<string, number>;
    cropsGrown?: Record<string, number>;
    modalsOpened?: Record<string, number>;
  };
  canComplete: boolean;
  startDialog?: IDialogStep[];
  endDialog?: IDialogStep[];
  startDialogSpeaker?: 'pet' | 'npc';
  endDialogSpeaker?: 'pet' | 'npc';
  autoTrigger?: string;
  startDialogShown?: boolean;
  /** Multi-step: current step id and steps array. */
  currentStepId?: string;
  steps?: IQuestStep[];
  /** For current step: dialog to show when step activates. */
  stepDialogBefore?: IDialogStep[];
  /** For current step: dialog to show when step completes. */
  stepDialogAfter?: IDialogStep[];
  stepBlocking?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function actionsToRecord(m: Map<string, number> | Record<string, number> | undefined): Record<string, number> {
  if (!m) return {};
  if (m instanceof Map) {
    const out: Record<string, number> = {};
    for (const [k, v] of m) out[k] = v;
    return out;
  }
  return { ...m };
}

function getActionCount(
  progress: { actions: Map<string, number> | Record<string, number> } | undefined,
  key: string,
): number {
  if (!progress?.actions) return 0;
  if (progress.actions instanceof Map) return progress.actions.get(key) ?? 0;
  return (progress.actions as Record<string, number>)[key] ?? 0;
}

function getMapCount(m: Map<string, number> | Record<string, number> | undefined, key: string): number {
  if (!m) return 0;
  if (m instanceof Map) return m.get(key) ?? 0;
  return (m as Record<string, number>)[key] ?? 0;
}

function getEffectiveRequirements(def: IQuestDef, uq: IUserQuest | null, currentStep: IQuestStep | null): IQuestRequirement {
  if (currentStep) return currentStep.requirements;
  return def.requirements;
}

function getCurrentStep(def: IQuestDef, uq: IUserQuest | null): IQuestStep | null {
  if (!def.steps?.length) return null;
  const stepId = uq?.currentStepId;
  if (stepId) {
    const step = def.steps.find((s) => s.stepId === stepId);
    if (step) return step;
  }
  return def.steps[0] ?? null;
}

function getNextStep(def: IQuestDef, currentStep: IQuestStep): IQuestStep | null {
  if (!def.steps?.length) return null;
  const nextId = currentStep.nextStepId;
  if (nextId) {
    const step = def.steps.find((s) => s.stepId === nextId);
    return step ?? null;
  }
  const idx = def.steps.findIndex((s) => s.stepId === currentStep.stepId);
  if (idx >= 0 && idx < def.steps.length - 1) return def.steps[idx + 1];
  return null;
}

async function loadFarm(userId: string): Promise<IFarm> {
  const farm = await Farm.findOne({ userId });
  if (!farm) throw new Error('Farm not found');
  return farm;
}

function countPlacedBuildings(farm: IFarm, itemType: string): number {
  const anchors = new Set<string>();
  for (const item of farm.placedItems) {
    if (item.itemType !== itemType) continue;
    const aid = item.anchorId ?? item.id;
    anchors.add(aid);
  }
  return anchors.size;
}

function checkRequirementsMet(
  req: IQuestRequirement,
  farm: IFarm,
  userQuest: IUserQuest | null,
): boolean {
  if (req.items?.length) {
    for (const { itemType, qty } of req.items) {
      if ((farm.inventory.get(itemType) ?? 0) < qty) return false;
    }
  }

  if (req.buildings?.length) {
    for (const { itemType, count } of req.buildings) {
      if (countPlacedBuildings(farm, itemType) < count) return false;
    }
  }

  if (req.actions?.length) {
    for (const { action, count, itemType } of req.actions) {
      const key = itemType ? `${action}:${itemType}` : action;
      if (getActionCount(userQuest?.progress, key) < count) return false;
    }
  }

  if (req.equips?.length) {
    const equipped = farm.equipped;
    for (const { slot, itemType } of req.equips) {
      const slotKey = slot as keyof NonNullable<typeof equipped>;
      const current = equipped?.[slotKey];
      if (itemType) {
        if (current !== itemType) return false;
      } else {
        if (!current) return false;
      }
    }
  }

  if (req.talk_to_npc?.length) {
    for (const { npcItemType, count = 1 } of req.talk_to_npc) {
      const key = npcItemType;
      if (getMapCount(userQuest?.progress?.npcTalks, key) < count) return false;
    }
  }

  if (req.crop_grown?.length) {
    for (const { itemType, count = 1 } of req.crop_grown) {
      const key = itemType;
      if (getMapCount(userQuest?.progress?.cropsGrown, key) < count) return false;
    }
  }

  if (req.open_modal?.length) {
    for (const { payload, count = 1 } of req.open_modal) {
      const key = payload;
      if (getMapCount(userQuest?.progress?.modalsOpened, key) < count) return false;
    }
  }

  return true;
}

function hasNoRequirements(req: IQuestRequirement): boolean {
  return (
    !req.items?.length &&
    !req.buildings?.length &&
    !req.actions?.length &&
    !req.equips?.length &&
    !req.talk_to_npc?.length &&
    !req.crop_grown?.length &&
    !req.open_modal?.length
  );
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const questService = {
  /**
   * Ensures UserQuest records exist for all defined quests.
   * Activates the next farm_upgrade quest if the previous one is completed.
   */
  async ensureUserQuests(userId: string): Promise<void> {
    const allDefs = await QuestDef.find().sort({ sortOrder: 1 }).lean();
    const existing = await UserQuest.find({ userId }).lean();
    const existingMap = new Map(existing.map((q) => [q.questId, q]));

    // Build a map of questId -> list of defs that autoTrigger it
    const triggeredBy = new Map<string, string[]>();
    for (const d of allDefs) {
      if (d.autoTrigger) {
        const list = triggeredBy.get(d.autoTrigger) ?? [];
        list.push(d.questId);
        triggeredBy.set(d.autoTrigger, list);
      }
    }

    for (const def of allDefs) {
      if (existingMap.has(def.questId)) continue;

      let status: 'locked' | 'active' = 'locked';

      // Auto-start tutorial_1 for every user (entry-point quest)
      if (def.questId === 'tutorial_1') {
        status = 'active';
      }

      // Triggers: start type = always active for new users
      if (status === 'locked' && def.triggers?.length) {
        for (const t of def.triggers) {
          if (t.type === 'start') {
            status = 'active';
            break;
          }
        }
      }

      // Triggers: quest_complete (replaces autoTrigger for new defs)
      if (status === 'locked' && def.triggers?.length) {
        for (const t of def.triggers) {
          if (t.type === 'quest_complete' && t.questId) {
            const otherUq = existingMap.get(t.questId);
            if (otherUq?.status === 'completed') {
              status = 'active';
              break;
            }
          }
        }
      }

      // requiredQuestId: must be completed before this quest can be active
      if (status === 'active' && def.requiredQuestId) {
        const reqUq = existingMap.get(def.requiredQuestId);
        if (reqUq?.status !== 'completed') status = 'locked';
      }

      // Farm upgrade sequential activation (backward compat)
      if (status === 'locked' && def.type === 'farm_upgrade') {
        if (def.farmLevel === 2) {
          status = 'active';
        } else if (def.farmLevel && def.farmLevel > 2) {
          const prevQuestId = `farm_upgrade_${def.farmLevel - 1}`;
          const prev = existingMap.get(prevQuestId);
          if (prev?.status === 'completed') status = 'active';
        }
      }

      // Generic autoTrigger: if any completed quest has autoTrigger pointing here, activate
      if (status === 'locked') {
        for (const otherDef of allDefs) {
          if (otherDef.autoTrigger === def.questId) {
            const otherUq = existingMap.get(otherDef.questId);
            if (otherUq?.status === 'completed') {
              status = 'active';
              break;
            }
          }
        }
      }

      const firstStepId = def.steps?.length ? def.steps[0].stepId : undefined;
      await UserQuest.create({
        userId,
        questId: def.questId,
        status,
        currentStepId: firstStepId,
        progress: { actions: new Map() },
      });
      existingMap.set(def.questId, { questId: def.questId, status } as any);
    }
  },

  /**
   * Returns all quests with user progress, enriched with canComplete flag.
   */
  async getQuestsForUser(userId: string): Promise<QuestProgressPayload[]> {
    await this.ensureUserQuests(userId);

    const [allDefs, userQuests, farm] = await Promise.all([
      QuestDef.find().sort({ sortOrder: 1 }).lean(),
      UserQuest.find({ userId }).lean(),
      loadFarm(userId),
    ]);

    const uqMap = new Map(userQuests.map((q) => [q.questId, q]));

    return allDefs.map((def) => {
      const uq = uqMap.get(def.questId) ?? null;
      const currentStep = getCurrentStep(def, uq);
      const effectiveReq = getEffectiveRequirements(def, uq, currentStep);
      const canComplete = uq?.status === 'active' && checkRequirementsMet(effectiveReq, farm, uq);

      // Compute live counts from farm/inventory (use effectiveReq for current step)
      const buildingCounts: Record<string, number> = {};
      if (effectiveReq.buildings?.length) {
        for (const { itemType } of effectiveReq.buildings) {
          buildingCounts[itemType] = countPlacedBuildings(farm, itemType);
        }
      }

      const itemCounts: Record<string, number> = {};
      if (effectiveReq.items?.length) {
        for (const { itemType } of effectiveReq.items) {
          itemCounts[itemType] = farm.inventory.get(itemType) ?? 0;
        }
      }

      return {
        questId: def.questId,
        type: def.type,
        title: def.title,
        description: def.description,
        farmLevel: def.farmLevel,
        petLevelMin: def.petLevelMin,
        farmLevelMin: def.farmLevelMin,
        requiredQuestId: def.requiredQuestId,
        triggers: def.triggers?.length ? def.triggers : undefined,
        requirements: effectiveReq,
        rewards: def.rewards ?? {},
        status: uq?.status ?? 'locked',
        progress: {
          actions: actionsToRecord(uq?.progress?.actions),
          buildings: buildingCounts,
          items: itemCounts,
          npcTalks: actionsToRecord(uq?.progress?.npcTalks),
          cropsGrown: actionsToRecord(uq?.progress?.cropsGrown),
          modalsOpened: actionsToRecord(uq?.progress?.modalsOpened),
        },
        canComplete,
        startDialog: def.startDialog?.length ? def.startDialog : undefined,
        endDialog: def.endDialog?.length ? def.endDialog : undefined,
        startDialogSpeaker: def.startDialogSpeaker,
        endDialogSpeaker: def.endDialogSpeaker,
        autoTrigger: def.autoTrigger,
        startDialogShown: uq?.startDialogShown ?? false,
        currentStepId: currentStep?.stepId,
        steps: def.steps,
        stepDialogBefore: currentStep?.dialogBefore?.length ? currentStep.dialogBefore : undefined,
        stepDialogAfter: currentStep?.dialogAfter?.length ? currentStep.dialogAfter : undefined,
        stepBlocking: currentStep?.blocking,
      };
    });
  },

  /**
   * Tries to activate locked quests by trigger. Returns activated quests with start dialogs.
   * Optionally pass activationContext (petLevel, farmLevel) to enforce min level requirements.
   */
  async tryActivateByTrigger(
    userId: string,
    triggerType: 'talk_to_npc' | 'enter_scene',
    payload: { npcItemType?: string; sceneSlug?: string },
    activationContext?: { petLevel?: number; farmLevel?: number },
  ): Promise<{
    activated: Array<{ questId: string; startDialog?: IDialogStep[]; npcItemType?: string }>;
    quests: QuestProgressPayload[];
    autoCompletedQuests?: Array<{
      questId: string;
      endDialog?: IDialogStep[];
      rewards?: IQuestDef['rewards'];
      nextQuestId?: string;
      nextQuestStartDialog?: IDialogStep[];
    }>;
  }> {
    await this.ensureUserQuests(userId);

    const [defsRaw, userQuests] = await Promise.all([
      QuestDef.find({ 'triggers.type': triggerType }).sort({ sortOrder: 1 }).lean(),
      UserQuest.find({ userId }).lean(),
    ]);
    const uqMap = new Map(userQuests.map((q) => [q.questId, q]));

    let defs = defsRaw.filter((d) => {
      const trigger = d.triggers?.find((t) => t.type === triggerType);
      if (!trigger) return false;
      if (triggerType === 'talk_to_npc' && trigger.npcItemType !== payload.npcItemType) return false;
      if (triggerType === 'enter_scene' && trigger.sceneSlug !== payload.sceneSlug) return false;
      return true;
    });

    // Filter by activation requirements (petLevelMin, farmLevelMin, requiredQuestId)
    if (activationContext || defs.some((d) => d.petLevelMin != null || d.farmLevelMin != null || d.requiredQuestId)) {
      const petLevel = activationContext?.petLevel ?? 1;
      const farmLevel = activationContext?.farmLevel ?? 1;
      defs = defs.filter((d) => {
        if (d.petLevelMin != null && petLevel < d.petLevelMin) return false;
        if (d.farmLevelMin != null && farmLevel < d.farmLevelMin) return false;
        if (d.requiredQuestId) {
          const reqUq = uqMap.get(d.requiredQuestId);
          if (reqUq?.status !== 'completed') return false;
        }
        return true;
      });
    }

    if (defs.length === 0) {
      log.info({ userId, triggerType, payload }, 'tryActivateByTrigger: no matching defs after filter');
      return { activated: [], quests: await this.getQuestsForUser(userId) };
    }

    // For enter_scene with firstVisitOnly: check if already visited
    if (triggerType === 'enter_scene' && payload.sceneSlug) {
      let progress = await UserProgress.findOne({ userId }).lean();
      if (!progress) {
        progress = await UserProgress.create({ userId, visitedScenes: [] });
      }
      const alreadyVisited = progress.visitedScenes?.includes(payload.sceneSlug) ?? false;
      defs = defs.filter((d) => {
        const trigger = d.triggers?.find((t) => t.type === 'enter_scene' && t.sceneSlug === payload.sceneSlug);
        if (trigger?.firstVisitOnly && alreadyVisited) return false;
        return true;
      });
      await UserProgress.findOneAndUpdate(
        { userId },
        { $addToSet: { visitedScenes: payload.sceneSlug } },
        { upsert: true },
      );
    }

    const lockedIds = defs.map((d) => d.questId);
    const updated = await UserQuest.updateMany(
      { userId, questId: { $in: lockedIds }, status: 'locked' },
      { $set: { status: 'active' } },
    );

    const activated: Array<{ questId: string; startDialog?: IDialogStep[]; npcItemType?: string }> = [];
    if (updated.modifiedCount > 0) {
      for (const def of defs) {
        const uq = await UserQuest.findOne({ userId, questId: def.questId });
        if (uq?.status === 'active') {
          const trigger = def.triggers?.find((t) => t.type === triggerType);
          const useNpcSpeaker = def.startDialogSpeaker !== 'pet';
          activated.push({
            questId: def.questId,
            startDialog: def.startDialog?.length ? def.startDialog : undefined,
            npcItemType:
              triggerType === 'talk_to_npc' && trigger?.npcItemType && useNpcSpeaker
                ? trigger.npcItemType
                : undefined,
          });
          if (def.startDialog?.length) {
            await UserQuest.updateOne(
              { userId, questId: def.questId },
              { $set: { startDialogShown: true } },
            );
          }
          log.info({ userId, questId: def.questId, triggerType, payload }, 'Quest activated by trigger');
        }
      }
    }

    // For talk_to_npc: record the npc talk so quests with that requirement are satisfied
    if (triggerType === 'talk_to_npc' && payload.npcItemType && activated.length > 0) {
      await this.trackNpcTalk(userId, payload.npcItemType);
    }

    let quests = await this.getQuestsForUser(userId);

    // Auto-complete any quests that are now eligible (e.g. no requirements, or talk_to_npc just satisfied)
    const autoCompletedQuests: Array<{
      questId: string;
      endDialog?: IDialogStep[];
      rewards?: IQuestDef['rewards'];
      nextQuestId?: string;
      nextQuestStartDialog?: IDialogStep[];
    }> = [];
    const autoCompleted = await this.autoCompleteEligibleQuests(userId);
    if (autoCompleted.length > 0) {
      quests = await this.getQuestsForUser(userId);
      autoCompletedQuests.push(...autoCompleted);
    }

    return {
      activated,
      quests,
      autoCompletedQuests: autoCompletedQuests.length > 0 ? autoCompletedQuests : undefined,
    };
  },

  /**
   * Checks if the next farm upgrade quest can be completed.
   */
  async canUpgradeFarm(userId: string, currentLevel: number): Promise<boolean> {
    const nextQuestId = `farm_upgrade_${currentLevel + 1}`;
    const [def, uq, farm] = await Promise.all([
      QuestDef.findOne({ questId: nextQuestId }).lean(),
      UserQuest.findOne({ userId, questId: nextQuestId }).lean(),
      loadFarm(userId),
    ]);
    if (!def || !uq || uq.status !== 'active') return false;
    return checkRequirementsMet(def, farm, uq);
  },

  /**
   * Completes a quest: consumes required items, grants rewards, marks complete.
   * For farm_upgrade quests, activates the next level's quest.
   * Returns updated inventory/gems for state update.
   */
  async completeQuest(userId: string, questId: string): Promise<{
    inventory: Record<string, number>;
    gems: number;
    farmXp: number;
    questCompleted: string;
    newFarmLevel?: number;
    endDialog?: IDialogStep[];
    rewards?: IQuestDef['rewards'];
    nextQuestId?: string;
    nextQuestStartDialog?: IDialogStep[];
  }> {
    const def = await QuestDef.findOne({ questId }).lean();
    if (!def) throw new Error('Quest not found');

    const uq = await UserQuest.findOne({ userId, questId });
    if (!uq) throw new Error('Quest not started');
    if (uq.status === 'completed') throw new Error('Quest already completed');
    if (uq.status === 'locked') throw new Error('Quest is locked');

    const farm = await loadFarm(userId);

    const currentStep = getCurrentStep(def, uq);
    const effectiveReq = getEffectiveRequirements(def, uq, currentStep);
    if (!checkRequirementsMet(effectiveReq, farm, uq)) {
      throw new Error('Quest requirements not met');
    }

    // Consume required items (from current/last step)
    if (effectiveReq.items?.length) {
      for (const { itemType, qty } of effectiveReq.items) {
        const current = farm.inventory.get(itemType) ?? 0;
        farm.inventory.set(itemType, current - qty);
      }
      farm.markModified('inventory');
    }

    // Grant rewards (top-level + per-step if applicable)
    const rewardsToGrant = [def.rewards];
    if (currentStep?.rewards) rewardsToGrant.push(currentStep.rewards);
    for (const rewards of rewardsToGrant) {
      if (rewards?.items?.length) {
        for (const { itemType, qty } of rewards.items) {
          const current = farm.inventory.get(itemType) ?? 0;
          farm.inventory.set(itemType, current + qty);
        }
        farm.markModified('inventory');
      }
      if (rewards?.gems) farm.gems += rewards.gems;
      if (rewards?.xp) farm.xp += rewards.xp;
    }

    await farm.save();

    // Mark quest completed
    uq.status = 'completed';
    uq.completedAt = new Date();
    await uq.save();

    log.info({ userId, questId }, 'Quest completed');

    // For farm_upgrade: activate next level's quest
    let newFarmLevel: number | undefined;
    if (def.type === 'farm_upgrade' && def.farmLevel) {
      newFarmLevel = def.farmLevel;
      const nextQuestId = `farm_upgrade_${def.farmLevel + 1}`;
      await UserQuest.updateOne(
        { userId, questId: nextQuestId, status: 'locked' },
        { $set: { status: 'active' } },
      );
    }

    // Generic autoTrigger: activate the next quest in the chain
    let nextQuestId: string | undefined;
    let nextQuestStartDialog: IDialogStep[] | undefined;
    if (def.autoTrigger) {
      let activated = await UserQuest.findOneAndUpdate(
        { userId, questId: def.autoTrigger, status: 'locked' },
        { $set: { status: 'active' } },
        { returnDocument: 'after' },
      );
      if (!activated) {
        const exists = await UserQuest.findOne({ userId, questId: def.autoTrigger });
        if (!exists) {
          const nextDefForCreate = await QuestDef.findOne({ questId: def.autoTrigger }).lean();
          const firstStepId = nextDefForCreate?.steps?.length ? nextDefForCreate.steps[0].stepId : undefined;
          activated = await UserQuest.create({
            userId,
            questId: def.autoTrigger,
            status: 'active',
            currentStepId: firstStepId,
            progress: { actions: new Map() },
          });
        }
      }
      if (activated) {
        nextQuestId = def.autoTrigger;
        const nextDef = await QuestDef.findOne({ questId: def.autoTrigger }).lean();
        if (nextDef?.startDialog?.length) {
          nextQuestStartDialog = nextDef.startDialog;
        }
      }
    }

    const inv: Record<string, number> = {};
    for (const [k, v] of farm.inventory) {
      if (v > 0) inv[k] = v;
    }

    const rewards: IQuestDef['rewards'] = {};
    if (def.rewards?.items?.length) rewards.items = def.rewards.items;
    if (def.rewards?.gems) rewards.gems = def.rewards.gems;
    if (def.rewards?.xp) rewards.xp = def.rewards.xp;
    if (currentStep?.rewards?.items?.length) {
      rewards.items = [...(rewards.items ?? []), ...currentStep.rewards.items];
    }
    if (currentStep?.rewards?.gems) rewards.gems = (rewards.gems ?? 0) + currentStep.rewards.gems;
    if (currentStep?.rewards?.xp) rewards.xp = (rewards.xp ?? 0) + currentStep.rewards.xp;

    return {
      inventory: inv,
      gems: farm.gems,
      farmXp: farm.xp,
      questCompleted: questId,
      newFarmLevel,
      endDialog: def.endDialog?.length ? def.endDialog : undefined,
      rewards: (rewards.items?.length || rewards.gems || rewards.xp) ? rewards : undefined,
      nextQuestId,
      nextQuestStartDialog,
    };
  },

  /**
   * Advances quest to next step when current step requirements are met.
   * For story/daily on last step: triggers auto-complete.
   */
  async advanceStepIfMet(userId: string): Promise<QuestProgressPayload[] | null> {
    const activeQuests = await UserQuest.find({ userId, status: 'active' });
    if (activeQuests.length === 0) return null;

    const questIds = activeQuests.map((q) => q.questId);
    const defs = await QuestDef.find({ questId: { $in: questIds } }).lean();
    const defMap = new Map(defs.map((d) => [d.questId, d]));
    const farm = await loadFarm(userId);

    let anyChanged = false;
    for (const uq of activeQuests) {
      const def = defMap.get(uq.questId);
      if (!def?.steps?.length) continue;

      const currentStep = getCurrentStep(def, uq);
      if (!currentStep) continue;

      const effectiveReq = getEffectiveRequirements(def, uq, currentStep);
      if (!checkRequirementsMet(effectiveReq, farm, uq)) continue;

      const nextStep = getNextStep(def, currentStep);
      if (nextStep) {
        uq.currentStepId = nextStep.stepId;
        uq.markModified('currentStepId');
        await uq.save();
        anyChanged = true;
        log.info({ userId, questId: uq.questId, from: currentStep.stepId, to: nextStep.stepId }, 'Quest step advanced');
      } else if (def.type !== 'farm_upgrade') {
        // Last step met for story/daily: auto-complete
        const results = await this.autoCompleteEligibleQuests(userId);
        if (results.length > 0) anyChanged = true;
      }
    }

    if (!anyChanged) return null;
    return this.getQuestsForUser(userId);
  },

  /**
   * Increments action counters on all active quests that track this action.
   * Supports both generic actions ("harvest") and item-specific ("harvest:wheat_seed").
   * Returns updated quest progress if any changed.
   */
  async trackAction(userId: string, action: string, itemType?: string): Promise<QuestProgressPayload[] | null> {
    const activeQuests = await UserQuest.find({ userId, status: 'active' });
    if (activeQuests.length === 0) return null;

    const questIds = activeQuests.map((q) => q.questId);
    const defs = await QuestDef.find({ questId: { $in: questIds } }).lean();
    const defMap = new Map(defs.map((d) => [d.questId, d]));

    let anyChanged = false;
    for (const uq of activeQuests) {
      const def = defMap.get(uq.questId);
      const currentStep = getCurrentStep(def!, uq);
      const effectiveReq = getEffectiveRequirements(def!, uq, currentStep);
      if (!effectiveReq?.actions?.length) continue;

      let questChanged = false;
      for (const reqAction of effectiveReq.actions) {
        if (reqAction.action !== action) continue;
        if (reqAction.itemType && reqAction.itemType !== itemType) continue;

        const key = reqAction.itemType ? `${action}:${reqAction.itemType}` : action;
        const current = uq.progress.actions.get(key) ?? 0;
        uq.progress.actions.set(key, current + 1);
        uq.markModified('progress.actions');
        questChanged = true;
        log.info({ questId: uq.questId, action, itemType, key, count: current + 1 }, 'Quest action tracked');
      }

      if (questChanged) {
        await uq.save();
        anyChanged = true;
      }
    }

    if (!anyChanged) return null;

    await this.advanceStepIfMet(userId);
    return this.getQuestsForUser(userId);
  },

  async trackNpcTalk(userId: string, npcItemType: string): Promise<QuestProgressPayload[] | null> {
    const activeQuests = await UserQuest.find({ userId, status: 'active' });
    if (activeQuests.length === 0) return null;

    const questIds = activeQuests.map((q) => q.questId);
    const defs = await QuestDef.find({ questId: { $in: questIds } }).lean();
    const defMap = new Map(defs.map((d) => [d.questId, d]));

    let anyChanged = false;
    for (const uq of activeQuests) {
      const def = defMap.get(uq.questId);
      const currentStep = getCurrentStep(def!, uq);
      const effectiveReq = getEffectiveRequirements(def!, uq, currentStep);
      if (!effectiveReq?.talk_to_npc?.length) continue;

      const matching = effectiveReq.talk_to_npc.filter((r) => r.npcItemType === npcItemType);
      if (matching.length === 0) continue;

      if (!uq.progress.npcTalks) uq.progress.npcTalks = new Map();
      const key = npcItemType;
      const current = uq.progress.npcTalks.get(key) ?? 0;
      uq.progress.npcTalks.set(key, current + 1);
      uq.markModified('progress.npcTalks');
      await uq.save();
      anyChanged = true;
      log.info({ questId: uq.questId, npcItemType, count: current + 1 }, 'Quest NPC talk tracked');
    }

    if (!anyChanged) return null;
    await this.advanceStepIfMet(userId);
    return this.getQuestsForUser(userId);
  },

  async trackCropGrown(userId: string, itemType: string): Promise<QuestProgressPayload[] | null> {
    const activeQuests = await UserQuest.find({ userId, status: 'active' });
    if (activeQuests.length === 0) return null;

    const questIds = activeQuests.map((q) => q.questId);
    const defs = await QuestDef.find({ questId: { $in: questIds } }).lean();
    const defMap = new Map(defs.map((d) => [d.questId, d]));

    let anyChanged = false;
    for (const uq of activeQuests) {
      const def = defMap.get(uq.questId);
      const currentStep = getCurrentStep(def!, uq);
      const effectiveReq = getEffectiveRequirements(def!, uq, currentStep);
      if (!effectiveReq?.crop_grown?.length) continue;

      const matching = effectiveReq.crop_grown.filter((r) => r.itemType === itemType);
      if (matching.length === 0) continue;

      if (!uq.progress.cropsGrown) uq.progress.cropsGrown = new Map();
      const key = itemType;
      const current = uq.progress.cropsGrown.get(key) ?? 0;
      uq.progress.cropsGrown.set(key, current + 1);
      uq.markModified('progress.cropsGrown');
      await uq.save();
      anyChanged = true;
      log.info({ questId: uq.questId, itemType, count: current + 1 }, 'Quest crop grown tracked');
    }

    if (!anyChanged) return null;
    await this.advanceStepIfMet(userId);
    return this.getQuestsForUser(userId);
  },

  async trackModalOpened(userId: string, payload: string): Promise<QuestProgressPayload[] | null> {
    const activeQuests = await UserQuest.find({ userId, status: 'active' });
    if (activeQuests.length === 0) return null;

    const questIds = activeQuests.map((q) => q.questId);
    const defs = await QuestDef.find({ questId: { $in: questIds } }).lean();
    const defMap = new Map(defs.map((d) => [d.questId, d]));

    let anyChanged = false;
    for (const uq of activeQuests) {
      const def = defMap.get(uq.questId);
      const currentStep = getCurrentStep(def!, uq);
      const effectiveReq = getEffectiveRequirements(def!, uq, currentStep);
      if (!effectiveReq?.open_modal?.length) continue;

      const matching = effectiveReq.open_modal.filter((r) => r.payload === payload);
      if (matching.length === 0) continue;

      if (!uq.progress.modalsOpened) uq.progress.modalsOpened = new Map();
      const key = payload;
      const current = uq.progress.modalsOpened.get(key) ?? 0;
      uq.progress.modalsOpened.set(key, current + 1);
      uq.markModified('progress.modalsOpened');
      await uq.save();
      anyChanged = true;
      log.info({ questId: uq.questId, payload, count: current + 1 }, 'Quest modal opened tracked');
    }

    if (!anyChanged) return null;
    await this.advanceStepIfMet(userId);
    return this.getQuestsForUser(userId);
  },

  /**
   * Auto-completes any active non-farm_upgrade quests whose requirements are fully met.
   * Grants rewards, marks complete, triggers next quest in chain.
   * Returns completion info for each auto-completed quest.
   */
  async autoCompleteEligibleQuests(userId: string): Promise<{
    questId: string;
    endDialog?: IDialogStep[];
    rewards?: IQuestDef['rewards'];
    nextQuestId?: string;
    nextQuestStartDialog?: IDialogStep[];
  }[]> {
    const activeQuests = await UserQuest.find({ userId, status: 'active' });
    if (activeQuests.length === 0) return [];

    const questIds = activeQuests.map((q) => q.questId);
    const defs = await QuestDef.find({ questId: { $in: questIds } }).lean();
    const defMap = new Map(defs.map((d) => [d.questId, d]));
    const farm = await loadFarm(userId);

    const results: {
      questId: string;
      endDialog?: IDialogStep[];
      rewards?: IQuestDef['rewards'];
      nextQuestId?: string;
      nextQuestStartDialog?: IDialogStep[];
    }[] = [];

    for (const uq of activeQuests) {
      const def = defMap.get(uq.questId);
      if (!def) continue;
      const currentStep = getCurrentStep(def, uq);
      const effectiveReq = getEffectiveRequirements(def, uq, currentStep);
      // farm_upgrade with requirements needs explicit user action (Upgrade Farm button);
      // farm_upgrade with no requirements (e.g. talk-to-unlock) can auto-complete
      if (def.type === 'farm_upgrade' && !hasNoRequirements(effectiveReq)) continue;
      if (!checkRequirementsMet(effectiveReq, farm, uq)) continue;

      // Consume required items (from current/last step)
      if (effectiveReq.items?.length) {
        for (const { itemType, qty } of effectiveReq.items) {
          const current = farm.inventory.get(itemType) ?? 0;
          farm.inventory.set(itemType, current - qty);
        }
        farm.markModified('inventory');
      }

      // Grant rewards (top-level + per-step)
      const rewardsToGrant = [def.rewards];
      if (currentStep?.rewards) rewardsToGrant.push(currentStep.rewards);
      for (const rewards of rewardsToGrant) {
        if (rewards?.items?.length) {
          for (const { itemType, qty } of rewards.items) {
            const current = farm.inventory.get(itemType) ?? 0;
            farm.inventory.set(itemType, current + qty);
          }
          farm.markModified('inventory');
        }
        if (rewards?.gems) farm.gems += rewards.gems;
        if (rewards?.xp) farm.xp += rewards.xp;
      }

      uq.status = 'completed';
      uq.completedAt = new Date();
      await uq.save();

      log.info({ userId, questId: uq.questId }, 'Quest auto-completed');

      let nextQuestId: string | undefined;
      let nextQuestStartDialog: IDialogStep[] | undefined;
      if (def.autoTrigger) {
        // Try to activate an existing locked record, or create one if it doesn't exist
        let activated = await UserQuest.findOneAndUpdate(
          { userId, questId: def.autoTrigger, status: 'locked' },
          { $set: { status: 'active' } },
          { returnDocument: 'after' },
        );
        if (!activated) {
          // Record may not exist yet — create it as active
          const exists = await UserQuest.findOne({ userId, questId: def.autoTrigger });
        if (!exists) {
          const nextDefForCreate = await QuestDef.findOne({ questId: def.autoTrigger }).lean();
          const firstStepId = nextDefForCreate?.steps?.length ? nextDefForCreate.steps[0].stepId : undefined;
          activated = await UserQuest.create({
            userId,
            questId: def.autoTrigger,
            status: 'active',
            currentStepId: firstStepId,
            progress: { actions: new Map() },
          });
        }
      }
      if (activated) {
        nextQuestId = def.autoTrigger;
        const nextDef = await QuestDef.findOne({ questId: def.autoTrigger }).lean();
        if (nextDef?.startDialog?.length) {
          nextQuestStartDialog = nextDef.startDialog;
            // Don't mark startDialogShown here — let getPendingDialogs re-send
            // on next load if the client misses this event
          }
        }
      }

      const rewards: IQuestDef['rewards'] = {};
      if (def.rewards?.items?.length) rewards.items = def.rewards.items;
      if (def.rewards?.gems) rewards.gems = def.rewards.gems;
      if (def.rewards?.xp) rewards.xp = def.rewards.xp;
      if (currentStep?.rewards?.items?.length) rewards.items = [...(rewards.items ?? []), ...currentStep.rewards.items];
      if (currentStep?.rewards?.gems) rewards.gems = (rewards.gems ?? 0) + currentStep.rewards.gems;
      if (currentStep?.rewards?.xp) rewards.xp = (rewards.xp ?? 0) + currentStep.rewards.xp;

      results.push({
        questId: uq.questId,
        endDialog: def.endDialog?.length ? def.endDialog : undefined,
        rewards: (rewards.items?.length || rewards.gems || rewards.xp) ? rewards : undefined,
        nextQuestId,
        nextQuestStartDialog,
      });
    }

    if (results.length > 0) {
      await farm.save();
    }

    return results;
  },

  /**
   * Returns pending start dialogs for active quests that haven't shown them yet.
   * Marks them as shown so they only fire once.
   */
  async getPendingDialogs(userId: string): Promise<{ questId: string; dialog: IDialogStep[] }[]> {
    await this.ensureUserQuests(userId);

    const activeQuests = await UserQuest.find({
      userId,
      status: 'active',
      startDialogShown: { $ne: true },
    }).lean();

    if (activeQuests.length === 0) return [];

    const questIds = activeQuests.map((q) => q.questId);
    const defs = await QuestDef.find({ questId: { $in: questIds } }).lean();
    const defMap = new Map(defs.map((d) => [d.questId, d]));

    const pending: { questId: string; dialog: IDialogStep[] }[] = [];
    for (const uq of activeQuests) {
      const def = defMap.get(uq.questId);
      if (def?.startDialog?.length) {
        pending.push({ questId: uq.questId, dialog: def.startDialog });
        await UserQuest.updateOne(
          { userId, questId: uq.questId },
          { $set: { startDialogShown: true } },
        );
      }
    }

    return pending;
  },

  /**
   * Returns the set of completed farm_upgrade levels for a user.
   */
  async getCompletedFarmLevels(userId: string): Promise<Set<number>> {
    const completed = await UserQuest.find({
      userId,
      status: 'completed',
      questId: /^farm_upgrade_/,
    }).lean();

    const levels = new Set<number>();
    for (const q of completed) {
      const match = q.questId.match(/^farm_upgrade_(\d+)$/);
      if (match) levels.add(parseInt(match[1]));
    }
    return levels;
  },
};
