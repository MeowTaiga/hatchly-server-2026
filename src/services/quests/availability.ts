import type { IQuestDef } from '../../models/QuestDef.js';

/**
 * Everything the availability rules are allowed to look at. Passing this in
 * explicitly keeps the rules a pure function of player state, which is what
 * makes them safe to re-run on every read.
 */
export interface AvailabilityContext {
  petLevel: number;
  farmLevel: number;
  completedQuestIds: Set<string>;
}

/**
 * Entry conditions. These are checked once, when a quest opens — a quest
 * already in progress is never pushed back to locked, so selling the building
 * that unlocked it can't strand the player mid-quest.
 */
export function gatesPass(def: Pick<IQuestDef, 'type' | 'farmLevel' | 'petLevelMin' | 'farmLevelMin' | 'requiredQuestId'>, ctx: AvailabilityContext): boolean {
  if (def.petLevelMin != null && ctx.petLevel < def.petLevelMin) return false;
  if (def.farmLevelMin != null && ctx.farmLevel < def.farmLevelMin) return false;
  if (def.requiredQuestId && !ctx.completedQuestIds.has(def.requiredQuestId)) return false;

  // An upgrade quest is relevant only while the farm sits one level below it.
  if (def.type === 'farm_upgrade') {
    if (!def.farmLevel) return false;
    if (def.farmLevel !== ctx.farmLevel + 1) return false;
  }

  return true;
}

/** Triggers that wait for the player to do something in the world. */
function eventTriggers(def: Pick<IQuestDef, 'triggers'>) {
  return (def.triggers ?? []).filter((t) => t.type === 'talk_to_npc' || t.type === 'enter_scene');
}

/**
 * Whether a locked quest should open right now, ignoring world events.
 *
 * A quest with `talk_to_npc` or `enter_scene` triggers can only be opened by
 * that event. Anything else — including a quest with no triggers at all —
 * opens as soon as its gates pass.
 */
export function shouldOpen(def: Pick<IQuestDef, 'type' | 'farmLevel' | 'petLevelMin' | 'farmLevelMin' | 'requiredQuestId' | 'triggers'>, ctx: AvailabilityContext): boolean {
  if (!gatesPass(def, ctx)) return false;
  if (eventTriggers(def).length > 0) return false;

  const triggers = def.triggers ?? [];
  if (triggers.length === 0) return true;

  for (const trigger of triggers) {
    if (trigger.type === 'start') return true;
    if (trigger.type === 'quest_complete' && trigger.questId && ctx.completedQuestIds.has(trigger.questId)) {
      return true;
    }
  }

  return false;
}

/**
 * Whether a world event opens this quest. Scene visits can be marked
 * first-visit-only, in which case a repeat visit must not re-open anything.
 */
export function matchesEvent(
  def: Pick<IQuestDef, 'type' | 'farmLevel' | 'petLevelMin' | 'farmLevelMin' | 'requiredQuestId' | 'triggers'>,
  event: { type: 'talk_to_npc'; npcItemType: string } | { type: 'enter_scene'; sceneSlug: string; alreadyVisited: boolean },
  ctx: AvailabilityContext,
): boolean {
  if (!gatesPass(def, ctx)) return false;

  for (const trigger of def.triggers ?? []) {
    if (trigger.type !== event.type) continue;
    if (event.type === 'talk_to_npc') {
      if (trigger.npcItemType === event.npcItemType) return true;
    } else {
      if (trigger.sceneSlug !== event.sceneSlug) continue;
      if (trigger.firstVisitOnly && event.alreadyVisited) continue;
      return true;
    }
  }

  return false;
}
