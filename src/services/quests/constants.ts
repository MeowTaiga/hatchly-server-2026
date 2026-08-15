/**
 * The quest vocabulary. Everything that authors can express lives here, and
 * both the runtime and the admin picklists read from it — the old code kept a
 * hand-maintained list in the admin route that had already drifted out of sync
 * with the actions services actually emit.
 */

/** Every action string a service may report. Adding one here exposes it to authors. */
export const QUEST_ACTIONS = [
  'place',
  'remove',
  'harvest',
  'water',
  'purchase',
  'sell',
  'catch',
  'cook',
  'craft',
  'learn',
  'shake_tree',
  'chop_tree',
  'dig_fossil',
  'mine_ore',
  'pickup_ground',
  'pop_balloon',
  'collect_water',
  'feed_pet',
  'spirit_snatch',
] as const;

export type QuestAction = (typeof QUEST_ACTIONS)[number];

export const EQUIP_SLOTS = ['handTool', 'bobber', 'bait', 'chair'] as const;

/**
 * UI elements a dialog step can point at. The app implements all of these; the
 * server used to accept only the first six, so the phone admin could compose
 * highlights that failed validation on save.
 */
export const DIALOG_HIGHLIGHT_TYPES = [
  'hud_button',
  'inventory_item',
  'world_item',
  'category_chip',
  'shop_item',
  'shop_category',
  'sell_item',
  'cook_item',
  'craft_item',
  'food_dish_item',
  'equip_item',
] as const;

export const HUD_BUTTON_TARGETS = [
  'backpack',
  'shop',
  'trash',
  'farm_info',
  'bestiary',
  'equip',
] as const;

export const QUEST_TYPES = ['farm_upgrade', 'story', 'daily'] as const;

/**
 * How a quest opens up. `start` (or no triggers at all) means "as soon as the
 * gates pass"; the rest wait for the named event. There is deliberately no
 * `manual` type any more — nothing could ever fire it.
 */
export const QUEST_TRIGGER_TYPES = ['start', 'quest_complete', 'talk_to_npc', 'enter_scene'] as const;

export const REQUIREMENT_KINDS = [
  'items',
  'buildings',
  'actions',
  'equips',
  'talk_to_npc',
  'crop_grown',
  'open_modal',
  'farmXp',
] as const;

export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

/** Verb shown in a requirement checklist, per action. */
export const ACTION_LABELS: Record<string, string> = {
  place: 'Place',
  remove: 'Remove',
  harvest: 'Harvest',
  water: 'Water',
  purchase: 'Buy',
  sell: 'Sell',
  catch: 'Catch',
  cook: 'Cook',
  craft: 'Craft',
  learn: 'Learn',
  shake_tree: 'Shake',
  chop_tree: 'Chop',
  dig_fossil: 'Dig up',
  mine_ore: 'Mine',
  pickup_ground: 'Pick up',
  pop_balloon: 'Pop',
  collect_water: 'Collect water',
  feed_pet: 'Feed your pet',
  spirit_snatch: 'Snatch treats',
};

/** Hedgehog gardener seeded on every new farm. Leaves after his last quest. */
export const STARTER_NPC_ITEM_TYPE = 'bramble';
export const STARTER_NPC_DEPARTURE_QUEST_ID = 'bramble_scarab_hunt';
