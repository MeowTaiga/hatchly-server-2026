/**
 * Random loot for checking off a goal. Recipes (cooking + crafting scrolls)
 * and cute Halloween deco from items3.txt — never tiled flooring / ground tiles.
 */

export const GOAL_REWARD_BUCKET_WEIGHTS = {
  cooking: 40,
  crafting: 40,
  deco: 20,
} as const;

/**
 * Placeable cute set pieces from items3.txt (Props, Haunted Decorations,
 * Witch Area, Harvest Area, Mushrooms, flower plants, a few atmosphere bits).
 * Item types match seedHalloweenSetPieces slugify: `${category}_${slug}`.
 */
export const GOAL_CUTE_DECO_ITEM_TYPES: readonly string[] = [
  // Props
  'decoration_jack_o_lantern',
  'decoration_carved_pumpkin_stack',
  'decoration_rotten_pumpkin',
  'decoration_pumpkin_wheelbarrow',
  'decoration_witch_cauldron',
  'decoration_spell_circle',
  'decoration_floating_candle',
  'decoration_candle_circle',
  'decoration_skull_candle',
  'decoration_bone_torch',
  'decoration_haunted_lantern',
  'decoration_rusted_lantern',
  'decoration_hanging_lantern',
  'decoration_ghost_lantern',
  'decoration_lantern_post',
  // Haunted decorations
  'decoration_floating_ghost',
  'decoration_ghost_family',
  'decoration_tiny_ghost',
  'decoration_wandering_spirit',
  'decoration_soul_flame',
  'decoration_floating_skull',
  'decoration_floating_eyeballs',
  'decoration_shadow_figure',
  'decoration_spirit_orb',
  'decoration_haunted_mirror',
  'decoration_haunted_doll',
  'decoration_creepy_scarecrow',
  'decoration_skeleton_display',
  'decoration_bone_totem',
  // Witch area (skip cottage)
  'decoration_potion_shelf',
  'decoration_herb_drying_rack',
  'decoration_broom_rack',
  'decoration_spell_table',
  'decoration_crystal_ball_pedestal',
  'decoration_potion_crate',
  'decoration_magic_bookshelf',
  'decoration_spellbook_stand',
  'decoration_witch_garden',
  'decoration_herb_garden',
  'decoration_rune_circle',
  'decoration_magic_crystal_cluster',
  'decoration_magic_lantern',
  'decoration_familiar_cat_statue',
  // Harvest
  'decoration_pumpkin_patch',
  'decoration_pumpkin_crate',
  'decoration_pumpkin_wagon',
  'decoration_hay_bale_stack',
  'decoration_corn_stalk_bundle',
  'decoration_apple_basket',
  'decoration_harvest_scarecrow',
  'decoration_harvest_sign',
  // Mushrooms
  'scenery_red_mushroom_cluster',
  'scenery_brown_mushroom_cluster',
  'scenery_poison_mushroom_patch',
  'scenery_ghost_mushroom',
  'scenery_glowing_blue_mushroom',
  'scenery_glowing_purple_mushroom',
  'scenery_witch_cap_mushroom',
  'scenery_bone_mushroom',
  'scenery_mooncap_mushroom',
  'scenery_fairy_mushroom_ring',
  // Flower-y plants
  'scenery_wilted_flowers',
  'scenery_black_roses',
  'scenery_blood_red_roses',
  'scenery_pale_lilies',
  'scenery_white_ghost_flowers',
  'scenery_spider_lily_patch',
  'scenery_pumpkin_vine',
  'scenery_hanging_ivy',
  'scenery_black_ivy',
  // Atmosphere
  'scenery_fireflies_purple',
  'scenery_blue_spirit_flames',
  'scenery_green_spirit_flames',
  'scenery_falling_leaves',
  'scenery_owl_perch',
  'scenery_crow_perch',
];
