import { GameItemDef } from '../../models/GameItemDef.js';
import { QuestDef, type IQuestDef } from '../../models/QuestDef.js';
import { Scene } from '../../models/Scene.js';
import {
  DIALOG_HIGHLIGHT_TYPES,
  EQUIP_SLOTS,
  HUD_BUTTON_TARGETS,
  QUEST_ACTIONS,
} from './constants.js';

/**
 * Authoring problems are reported per field so the admin UI can point at the
 * offending row. `error` blocks the save; `warning` is advisory.
 */
export interface QuestProblem {
  questId: string;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

/** A quest definition as the admin routes receive it, before it becomes a document. */
export type QuestDraft = Pick<
  IQuestDef,
  | 'questId'
  | 'type'
  | 'title'
  | 'farmLevel'
  | 'petLevelMin'
  | 'farmLevelMin'
  | 'requiredQuestId'
  | 'requirements'
  | 'rewards'
  | 'triggers'
  | 'startDialog'
  | 'endDialog'
  | 'progressDialog'
>;

interface World {
  items: Map<string, { placeable?: boolean; category?: string; interactPayload?: string }>;
  sceneSlugs: Set<string>;
  questIds: Set<string>;
  /** farmLevel → questIds that grant it, for spotting duplicates. */
  upgradeLevels: Map<number, string[]>;
}

/**
 * Loads everything a quest can point at. The whole reason quests silently broke
 * before is that nothing checked these references — a tutorial asked players to
 * place `soil_patch`, an item that has never existed, and the counter simply
 * never moved.
 */
async function loadWorld(): Promise<World> {
  const [itemDocs, sceneDocs, questDocs] = await Promise.all([
    GameItemDef.find({}, { itemType: 1, placeable: 1, category: 1, 'interactAction.payload': 1 }).lean(),
    Scene.find({}, { slug: 1 }).lean(),
    QuestDef.find({}, { questId: 1, type: 1, farmLevel: 1 }).lean(),
  ]);

  const upgradeLevels = new Map<number, string[]>();
  for (const q of questDocs) {
    if (q.type !== 'farm_upgrade' || !q.farmLevel) continue;
    upgradeLevels.set(q.farmLevel, [...(upgradeLevels.get(q.farmLevel) ?? []), q.questId]);
  }

  return {
    items: new Map(itemDocs.map((d) => [d.itemType, {
      placeable: d.placeable,
      category: d.category,
      interactPayload: d.interactAction?.payload,
    }])),
    sceneSlugs: new Set(sceneDocs.map((s) => s.slug)),
    questIds: new Set(questDocs.map((q) => q.questId)),
    upgradeLevels,
  };
}

export async function validateQuest(draft: QuestDraft, world?: World): Promise<QuestProblem[]> {
  const w = world ?? await loadWorld();
  const problems: QuestProblem[] = [];
  const questId = draft.questId;

  const add = (field: string, message: string, severity: 'error' | 'warning' = 'error') =>
    problems.push({ questId, field, message, severity });

  const checkItem = (itemType: string, field: string) => {
    if (!w.items.has(itemType)) add(field, `No item called "${itemType}" exists`);
  };

  const req = draft.requirements ?? {};

  req.items?.forEach((r, i) => checkItem(r.itemType, `requirements.items[${i}].itemType`));

  req.buildings?.forEach((r, i) => {
    const field = `requirements.buildings[${i}].itemType`;
    checkItem(r.itemType, field);
    const item = w.items.get(r.itemType);
    if (item && !item.placeable) add(field, `"${r.itemType}" can't be placed, so this can never be satisfied`);
  });

  req.actions?.forEach((r, i) => {
    if (!QUEST_ACTIONS.includes(r.action as never)) {
      add(`requirements.actions[${i}].action`, `"${r.action}" isn't an action the game reports`);
    }
    if (r.itemType) checkItem(r.itemType, `requirements.actions[${i}].itemType`);
  });

  req.equips?.forEach((r, i) => {
    if (!EQUIP_SLOTS.includes(r.slot as never)) {
      add(`requirements.equips[${i}].slot`, `"${r.slot}" isn't an equipment slot`);
    }
    if (r.itemType) checkItem(r.itemType, `requirements.equips[${i}].itemType`);
  });

  req.talk_to_npc?.forEach((r, i) => {
    const field = `requirements.talk_to_npc[${i}].npcItemType`;
    checkItem(r.npcItemType, field);
    const item = w.items.get(r.npcItemType);
    if (item && item.category !== 'npc') {
      add(field, `"${r.npcItemType}" isn't an NPC, so it can't be talked to`, 'warning');
    }
  });

  req.crop_grown?.forEach((r, i) => checkItem(r.itemType, `requirements.crop_grown[${i}].itemType`));

  req.open_modal?.forEach((r, i) => {
    const known = [...w.items.values()].some((it) => it.interactPayload === r.payload);
    if (!known) {
      add(`requirements.open_modal[${i}].payload`, `No item opens "${r.payload}"`, 'warning');
    }
  });

  draft.rewards?.items?.forEach((r, i) => checkItem(r.itemType, `rewards.items[${i}].itemType`));

  draft.rewards?.recipes?.forEach((recipeId, i) => {
    if (!recipeId?.trim()) {
      add(`rewards.recipes[${i}]`, 'Recipe id is empty');
    }
  });

  // ── Availability ──
  if (draft.requiredQuestId) {
    if (draft.requiredQuestId === questId) {
      add('requiredQuestId', 'A quest cannot require itself');
    } else if (!w.questIds.has(draft.requiredQuestId)) {
      add('requiredQuestId', `No quest called "${draft.requiredQuestId}" exists`);
    }
  }

  draft.triggers?.forEach((t, i) => {
    const field = `triggers[${i}]`;
    if (t.type === 'talk_to_npc') {
      if (!t.npcItemType) {
        add(field, 'Pick an NPC, or this trigger can never fire');
      } else {
        checkItem(t.npcItemType, `${field}.npcItemType`);
        const item = w.items.get(t.npcItemType);
        if (item && item.category !== 'npc') {
          add(`${field}.npcItemType`, `"${t.npcItemType}" isn't an NPC, so it can't be talked to`);
        }
      }
    }
    if (t.type === 'enter_scene') {
      if (!t.sceneSlug) add(field, 'Pick a scene, or this trigger can never fire');
      else if (!w.sceneSlugs.has(t.sceneSlug)) add(`${field}.sceneSlug`, `No scene called "${t.sceneSlug}" exists`);
    }
    if (t.type === 'quest_complete') {
      if (!t.questId) add(field, 'Pick the quest that unlocks this one');
      else if (t.questId === questId) add(`${field}.questId`, 'A quest cannot unlock itself');
      else if (!w.questIds.has(t.questId)) add(`${field}.questId`, `No quest called "${t.questId}" exists`);
    }
  });

  // ── Farm upgrades ──
  if (draft.type === 'farm_upgrade') {
    if (!draft.farmLevel) {
      add('farmLevel', 'An upgrade quest must say which level it unlocks');
    } else {
      const others = (w.upgradeLevels.get(draft.farmLevel) ?? []).filter((id) => id !== questId);
      if (others.length > 0) {
        add('farmLevel', `"${others.join('", "')}" already unlocks level ${draft.farmLevel}`, 'warning');
      }
    }
  } else if (draft.farmLevel) {
    add('farmLevel', 'Only upgrade quests unlock a farm level', 'warning');
  }

  // ── Dialog ──
  const checkDialog = (steps: typeof draft.startDialog, key: string) => {
    steps?.forEach((step, i) => {
      const h = step.highlight;
      if (!h) return;
      const field = `${key}[${i}].highlight`;
      if (!DIALOG_HIGHLIGHT_TYPES.includes(h.type as never)) {
        add(`${field}.type`, `"${h.type}" isn't a highlight the app knows how to draw`);
        return;
      }
      if (h.type === 'hud_button') {
        if (!HUD_BUTTON_TARGETS.includes(h.target as never)) {
          add(`${field}.target`, `"${h.target}" isn't a HUD button`);
        }
      } else if (h.type !== 'category_chip' && h.type !== 'shop_category') {
        checkItem(h.target, `${field}.target`);
      }
    });
  };
  checkDialog(draft.startDialog, 'startDialog');
  checkDialog(draft.endDialog, 'endDialog');
  checkDialog(draft.progressDialog, 'progressDialog');

  // ── Shape warnings ──
  const noRequirements =
    !req.items?.length && !req.buildings?.length && !req.actions?.length &&
    !req.equips?.length && !req.talk_to_npc?.length && !req.crop_grown?.length &&
    !req.open_modal?.length && !req.farmXp;

  if (noRequirements && draft.type !== 'farm_upgrade') {
    add('requirements', 'With no requirements this quest completes the instant it opens', 'warning');
  }

  return problems;
}

/** Validates every stored quest, for the admin health panel. */
export async function lintAllQuests(): Promise<QuestProblem[]> {
  const world = await loadWorld();
  const quests = await QuestDef.find().lean();
  const problems: QuestProblem[] = [];
  for (const quest of quests) {
    problems.push(...await validateQuest(quest as unknown as QuestDraft, world));
  }
  return problems;
}
