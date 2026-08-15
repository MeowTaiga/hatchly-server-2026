/**
 * Built-in self-care goals (Finch-style catalog). Seeded onto each user
 * the first time they load goals. Icons prefer existing GameItemDefs with art;
 * walking_shoes / yoga_mat are dedicated seeds.
 */

export type GoalRepeat = 'daily' | 'weekdays' | 'once';

export interface GoalCatalogEntry {
  id: string;
  title: string;
  iconItemType: string;
  rewardItemType: string;
  defaultEnabled: boolean;
  /** Local 24h HH:mm — reminder is on by default for catalog goals. */
  defaultRemindAt: string;
}

export const GOAL_HEALTH_XP = 10;
export const GOAL_SOCIAL_XP = 6;
/** First N completes each day grant XP + a random recipe/deco. Undo does not refund a slot. */
export const GOAL_MAX_REWARDED_PER_DAY = 4;
/** Fallback if the random pool is empty. */
export const GOAL_DEFAULT_REWARD_ITEM = 'wheat_seed';
/** Custom goals remind at 11:00 in the user's timezone unless they change it. */
export const GOAL_CUSTOM_DEFAULT_REMIND_AT = '11:00';

export const GOAL_CATALOG: GoalCatalogEntry[] = [
  { id: 'drink_water', title: 'Drink water', iconItemType: 'water_bowl', rewardItemType: 'water', defaultEnabled: true, defaultRemindAt: '09:00' },
  { id: 'take_a_walk', title: 'Take a walk', iconItemType: 'walking_shoes', rewardItemType: 'stick', defaultEnabled: true, defaultRemindAt: '12:00' },
  { id: 'journal', title: 'Journal', iconItemType: 'open_notebook', rewardItemType: 'wheat_seed', defaultEnabled: true, defaultRemindAt: '20:00' },
  { id: 'stretch', title: 'Stretch', iconItemType: 'yoga_mat', rewardItemType: 'stick', defaultEnabled: false, defaultRemindAt: '08:30' },
  { id: 'clean_up', title: 'Clean up', iconItemType: 'cleaning_bucket', rewardItemType: 'stick', defaultEnabled: false, defaultRemindAt: '18:00' },
  { id: 'wind_down', title: 'Wind down', iconItemType: 'sleep_mask', rewardItemType: 'wheat_seed', defaultEnabled: false, defaultRemindAt: '21:00' },
  { id: 'brush_teeth', title: 'Brush teeth', iconItemType: 'toothbrush_cup', rewardItemType: 'apple', defaultEnabled: false, defaultRemindAt: '08:00' },
  { id: 'eat_a_fruit', title: 'Eat a fruit', iconItemType: 'apple', rewardItemType: 'apple', defaultEnabled: false, defaultRemindAt: '10:00' },
  { id: 'get_some_sun', title: 'Get some sun', iconItemType: 'sunflower_vase', rewardItemType: 'wheat_seed', defaultEnabled: false, defaultRemindAt: '11:00' },
];

/** Default folder art for named sections (`__general` = ungrouped). */
export const DEFAULT_SECTION_ICONS: Record<string, string> = {
  __general: 'open_notebook',
  Household: 'cleaning_bucket',
  Bills: 'bulletin_board',
  Work: 'computer_desk',
  Health: 'water_bowl',
  Fitness: 'walking_shoes',
  Groceries: 'grocery_bag',
  Pets: 'calico_cat_plush',
  Family: 'bunny_plush',
  Errands: 'camp_backpack',
  Finance: 'hourglass',
  School: 'open_book',
  'Self-care': 'aroma_diffuser',
  Travel: 'sleeping_bag',
};

/** Icons shown in the custom-goal / section picker. */
export const GOAL_ICON_PICKER: string[] = [
  ...new Set([
    ...GOAL_CATALOG.map((e) => e.iconItemType),
    ...Object.values(DEFAULT_SECTION_ICONS),
    'open_book',
    'vacuum_cleaner',
    'decoration_broom_rack',
    'sketchbook',
    'hot_water_bottle',
    'teapot',
    'pastel_mug',
    'pastel_alarm_clock',
    'laundry_basket',
    'strawberry',
    'banana',
    'acoustic_guitar',
    'dark_oak_candle',
    'monstera_potted_plant',
    'picnic_blanket',
    'honey',
    'milk',
    'lavender',
    'lemonade',
    'bread',
    'toast',
    'pizza',
    'cheese_sandwich',
    'yogurt',
    'berry_smoothie',
    'apple_pie',
    'chamomile_tea',
    'carrot',
    'grapes',
    'orange',
    'honey_cookies',
    'cottage_bed',
    'pastel_couch',
    'cottage_armchair',
    'cafe_table',
    'cabin_rocking_chair',
    'computer_desk',
    'pastel_vanity',
    'cat_bed',
    'alarm_clock',
    'aroma_diffuser',
    'bath_candle',
    'bath_plant',
    'bath_tray',
    'bathroom_mirror',
    'beach_chair',
    'beach_towel',
    'bed_tray',
    'berry_bowl',
    'bicycle_helmet',
    'bonsai_tree',
    'bookmark_collection',
    'bread_basket',
    'bubble_bath_bucket',
    'bulletin_board',
    'cactus_pot',
    'calico_cat_plush',
    'camp_backpack',
    'campfire_marshmallow_kit',
    'campfire_ring',
    'candle_trio',
    'cat_fish_plushie',
    'cookie_jar',
    'cutting_board',
    'grocery_bag',
    'hourglass',
    'paint_palette',
    'pencil_cup',
    'popcorn',
    'shopping_basket',
    'yarn_basket',
    'bunny_plush',
    'axolotl_plush',
    'basic_fishing_pole',
    'bee_hotel',
    'bird_watching_binoculars',
    'butterfly_net',
    'crystal',
    'decoration_bedroll',
    'dog_bed',
    'dreamcatcher',
    'espresso_machine',
    'goldfish_bowl',
    'moon_lamp',
    'mushroom_stool',
    'record_player',
    'shovel',
    'sleeping_bag',
    'goldfish',
    'cabin_lamp',
    'apple_juice',
    'keyboard',
    'fridge',
    'mail_box',
  ]),
];

export function catalogEntryById(id: string): GoalCatalogEntry | undefined {
  return GOAL_CATALOG.find((e) => e.id === id);
}

function normalizeGoalText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const CATALOG_ALIASES: Record<string, string> = {
  walk: 'take_a_walk',
  walking: 'take_a_walk',
  'take a walk': 'take_a_walk',
  'go for a walk': 'take_a_walk',
  water: 'drink_water',
  'drink water': 'drink_water',
  hydrate: 'drink_water',
  journal: 'journal',
  journaling: 'journal',
  diary: 'journal',
  stretch: 'stretch',
  stretching: 'stretch',
  yoga: 'stretch',
  'clean up': 'clean_up',
  cleanup: 'clean_up',
  tidy: 'clean_up',
  'wind down': 'wind_down',
  'brush teeth': 'brush_teeth',
  toothbrush: 'brush_teeth',
  'eat a fruit': 'eat_a_fruit',
  'eat fruit': 'eat_a_fruit',
  'get some sun': 'get_some_sun',
  sunshine: 'get_some_sun',
};

/** Exact catalog match only. Specific titles like "deep clean kitchen" never map here. */
export function matchCatalogEntry(text: string): GoalCatalogEntry | undefined {
  const n = normalizeGoalText(text);
  if (!n) return undefined;
  const aliasId = CATALOG_ALIASES[n];
  if (aliasId) return catalogEntryById(aliasId);
  return GOAL_CATALOG.find(
    (e) => normalizeGoalText(e.title) === n || e.id === n || e.id.replace(/_/g, ' ') === n,
  );
}

export function pickGoalIconFromTitle(title: string): string {
  const t = title.toLowerCase();
  if (/walk|run|jog|hike/.test(t)) return 'walking_shoes';
  if (/stretch|yoga|flex/.test(t)) return 'yoga_mat';
  if (/water|hydrat|drink/.test(t)) return 'water_bowl';
  if (/journal|diary|write/.test(t)) return 'open_notebook';
  if (/vacuum/.test(t)) return 'vacuum_cleaner';
  if (/broom|sweep/.test(t)) return 'decoration_broom_rack';
  if (/laundry|wash clothes/.test(t)) return 'laundry_basket';
  if (/clean|kitchen|dishes|tidy/.test(t)) return 'cleaning_bucket';
  if (/sleep|wind down|bed|rest/.test(t)) return 'sleep_mask';
  if (/teeth|brush/.test(t)) return 'toothbrush_cup';
  if (/fruit|apple/.test(t)) return 'apple';
  if (/sun|outside|vitamin d/.test(t)) return 'sunflower_vase';
  if (/read|book/.test(t)) return 'open_book';
  if (/sketch|draw|art/.test(t)) return 'sketchbook';
  if (/tea|coffee|mug/.test(t)) return 'pastel_mug';
  if (/music|guitar|practice/.test(t)) return 'acoustic_guitar';
  if (/plant|garden/.test(t)) return 'monstera_potted_plant';
  if (/wake|alarm|morning/.test(t)) return 'pastel_alarm_clock';
  if (/meditat|calm|candle/.test(t)) return 'dark_oak_candle';
  if (/smoothie/.test(t)) return 'berry_smoothie';
  if (/pizza/.test(t)) return 'pizza';
  if (/sandwich|lunch/.test(t)) return 'cheese_sandwich';
  if (/cook|bake|pie/.test(t)) return 'apple_pie';
  if (/desk|work|study/.test(t)) return 'computer_desk';
  if (/\bcat\b/.test(t)) return 'cat_bed';
  return 'open_notebook';
}
