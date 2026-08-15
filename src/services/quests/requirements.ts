import type { IQuestRequirement } from '../../models/QuestDef.js';
import type { IUserQuest } from '../../models/UserQuest.js';
import type { IFarm } from '../../models/Farm.js';
import { ACTION_LABELS } from './constants.js';

/**
 * One line of a quest's checklist, already resolved against the player's state.
 *
 * The old payload shipped the raw requirement object plus four loose counter
 * maps and left the app to pair them up, which meant the same matching rules
 * were implemented twice and disagreed. Clauses are computed once, here.
 */
export interface RequirementClause {
  /** Stable identity for React keys and for matching progress across refreshes. */
  key: string;
  kind: 'item' | 'building' | 'action' | 'equip' | 'talk_to_npc' | 'crop_grown' | 'open_modal' | 'farm_xp';
  /** Ready-to-render text, e.g. "Harvest Wheat". */
  label: string;
  /** Item to draw an icon for, when the clause is about one. */
  itemType?: string;
  have: number;
  need: number;
  met: boolean;
}

/** Counter progress lives on the UserQuest; everything else is read live from the farm. */
export interface EvaluationContext {
  farm: IFarm;
  userQuest: IUserQuest | null;
  /** itemType → display label, for composing clause text. */
  itemLabels: Map<string, string>;
}

function counter(
  map: Map<string, number> | Record<string, number> | undefined,
  key: string,
): number {
  if (!map) return 0;
  if (map instanceof Map) return map.get(key) ?? 0;
  return map[key] ?? 0;
}

/** Action counters are keyed `action:itemType`, or bare `action` when item-agnostic. */
export function actionKey(action: string, itemType?: string): string {
  return itemType ? `${action}:${itemType}` : action;
}

/**
 * Actions that need a tool in hand. Equip clauses render immediately before
 * these so the log never asks you to catch a fish before equipping the pole.
 */
const TOOL_ACTIONS = new Set([
  'catch',
  'chop_tree',
  'mine_ore',
  'dig_fossil',
  'shake_tree',
  'harvest',
  'spirit_snatch',
]);

/**
 * Buildings are counted by anchor, so a 2x2 building placed once counts once
 * rather than once per occupied tile.
 */
export function countPlacedBuildings(farm: IFarm, itemType: string): number {
  const anchors = new Set<string>();
  for (const item of farm.placedItems) {
    if (item.itemType !== itemType) continue;
    anchors.add(item.anchorId ?? item.id);
  }
  return anchors.size;
}

export function counterMapToRecord(
  map: Map<string, number> | Record<string, number> | undefined,
): Record<string, number> {
  if (!map) return {};
  if (map instanceof Map) return Object.fromEntries(map);
  return { ...map };
}

/**
 * Expands a requirement block into checklist clauses.
 *
 * Every clause carries both sides of the comparison so the app can render
 * "3 / 10" without knowing how any requirement kind is stored.
 */
export function evaluateRequirements(
  req: IQuestRequirement | undefined,
  ctx: EvaluationContext,
): RequirementClause[] {
  const clauses: RequirementClause[] = [];
  if (!req) return clauses;

  const name = (itemType: string) => ctx.itemLabels.get(itemType) ?? itemType;
  const progress = ctx.userQuest?.progress;

  const actionClause = (action: string, count: number, itemType?: string): RequirementClause => {
    const have = counter(progress?.actions, actionKey(action, itemType));
    const verb = ACTION_LABELS[action] ?? action;
    const label = itemType
      ? `${verb} ${name(itemType)}`
      : action === 'shake_tree'
        ? 'Shake a tree'
        : action === 'catch'
          ? 'Catch something'
          : verb;
    return {
      key: `action:${actionKey(action, itemType)}`,
      kind: 'action',
      label,
      itemType,
      have,
      need: count,
      met: have >= count,
    };
  };

  const learn: RequirementClause[] = [];
  const prep: RequirementClause[] = [];
  const tool: RequirementClause[] = [];
  for (const { action, count, itemType } of req.actions ?? []) {
    const clause = actionClause(action, count, itemType);
    if (action === 'learn') learn.push(clause);
    else if (TOOL_ACTIONS.has(action)) tool.push(clause);
    else prep.push(clause);
  }

  // Play order: learn scrolls → place buildings → open them → prep work →
  // equip the tool → use it → bring items → talk. Authors store kinds in
  // separate arrays, so a fixed kind dump put "catch a fish" before "equip pole".
  clauses.push(...learn);

  for (const { itemType, count } of req.buildings ?? []) {
    const have = countPlacedBuildings(ctx.farm, itemType);
    clauses.push({
      key: `building:${itemType}`,
      kind: 'building',
      label: `Place ${name(itemType)}`,
      itemType,
      have,
      need: count,
      met: have >= count,
    });
  }

  for (const { payload, count = 1 } of req.open_modal ?? []) {
    const have = counter(progress?.modalsOpened, payload);
    clauses.push({
      key: `modal:${payload}`,
      kind: 'open_modal',
      label: `Open ${payload.replace(/_/g, ' ')}`,
      have,
      need: count,
      met: have >= count,
    });
  }

  for (const { itemType, count = 1 } of req.crop_grown ?? []) {
    const have = counter(progress?.cropsGrown, itemType);
    clauses.push({
      key: `grow:${itemType}`,
      kind: 'crop_grown',
      label: `Grow ${name(itemType)}`,
      itemType,
      have,
      need: count,
      met: have >= count,
    });
  }

  if (req.farmXp) {
    clauses.push({
      key: 'farmXp',
      kind: 'farm_xp',
      label: 'Reach farm XP',
      have: ctx.farm.xp,
      need: req.farmXp,
      met: ctx.farm.xp >= req.farmXp,
    });
  }

  clauses.push(...prep);

  for (const { slot, itemType } of req.equips ?? []) {
    const equippedInSlot = ctx.farm.equipped?.[slot as keyof NonNullable<IFarm['equipped']>];
    const met = itemType ? equippedInSlot === itemType : Boolean(equippedInSlot);
    clauses.push({
      key: `equip:${slot}:${itemType ?? 'any'}`,
      kind: 'equip',
      label: itemType ? `Equip ${name(itemType)}` : `Equip something in ${slot}`,
      itemType,
      have: met ? 1 : 0,
      need: 1,
      met,
    });
  }

  clauses.push(...tool);

  for (const { itemType, qty } of req.items ?? []) {
    const have = ctx.farm.inventory.get(itemType) ?? 0;
    clauses.push({
      key: `item:${itemType}`,
      kind: 'item',
      label: `Bring ${name(itemType)}`,
      itemType,
      have,
      need: qty,
      met: have >= qty,
    });
  }

  for (const { npcItemType, count = 1 } of req.talk_to_npc ?? []) {
    const have = counter(progress?.npcTalks, npcItemType);
    clauses.push({
      key: `talk:${npcItemType}`,
      kind: 'talk_to_npc',
      label: `Talk to ${name(npcItemType)}`,
      itemType: npcItemType,
      have,
      need: count,
      met: have >= count,
    });
  }

  return clauses;
}

export function clausesMet(clauses: RequirementClause[]): boolean {
  return clauses.every((c) => c.met);
}

export function isEmptyRequirement(req: IQuestRequirement | undefined): boolean {
  if (!req) return true;
  return (
    !req.items?.length &&
    !req.buildings?.length &&
    !req.actions?.length &&
    !req.equips?.length &&
    !req.talk_to_npc?.length &&
    !req.crop_grown?.length &&
    !req.open_modal?.length &&
    !req.farmXp
  );
}
