/**
 * Equip slot configuration. Single source of truth for server.
 * handTool = mutually exclusive (fishing pole, bug net, pickaxe, etc.)
 * chair, bobber, bait = independent slots.
 */

export const HAND_TOOL_SUB_CATEGORIES = [
  'fishing_poles',
  'fishing_pole',
  'net',
  'bug_net',
  'bug_nets',
  'pickaxe',
  'pickaxes',
  'axe',
  'axes',
  'shovel',
  'shovels',
] as const;

export const EQUIP_SLOTS = ['handTool', 'bobber', 'bait', 'chair'] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

export const SLOT_TO_SUB_CATEGORIES: Record<string, string | string[]> = {
  handTool: [...HAND_TOOL_SUB_CATEGORIES],
  bobber: 'fishing_bobber',
  bait: 'bait',
  chair: ['chairs', 'chair'],
};
