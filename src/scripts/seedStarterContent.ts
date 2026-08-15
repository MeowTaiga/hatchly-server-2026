/**
 * Seeds a playable opening: one pet tidy quest, then a Bramble-owned story
 * ladder (farming → crafting/bugs → storage → stash → shovel digs →
 * axe → pickaxe → carrots → pet food bowl → town-level kitchen → feast),
 * side lessons (sell, mail, shop, orchard, pumpkins, sugar, well), a town
 * Fennec fishing track (farm level 2+), Mrs. Teagan's cooking recipe track
 * (NPC def + quests only — not auto-placed), plus parallel farm-upgrade quests.
 *
 * Bramble story quests are chained one-at-a-time (requiredQuestId +
 * quest_complete triggers) so players are not juggling multiple hedge quests.
 *
 * Everything goes through the running server's admin API, so each quest is
 * checked by the same validator the admin panel uses and new items are
 * broadcast to connected clients. Re-running updates in place rather than
 * duplicating, so it is safe to tweak the content below and run it again.
 *
 * Run: npm run seed:starter -- <adminUserId> [--replay] [--no-art] [--no-place] [--no-kit]
 *
 * `--replay` also wipes that account's quest progress so the ladder can be
 * played from the top. It leaves the farm at its current size, so nothing
 * already built gets stranded outside a smaller fence.
 */
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const userId = process.argv[2];
const flags = new Set(process.argv.slice(3));
if (!userId) {
  console.error(
    'Usage: npm run seed:starter -- <adminUserId> [--replay] [--no-art] [--no-place] [--no-kit]',
  );
  process.exit(1);
}

const token = jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: '1h' });
const base = `http://localhost:${env.PORT}`;

// ─── Transport ──────────────────────────────────────────────────────────────

interface Envelope<T> {
  success?: boolean;
  data?: T;
  message?: string;
  code?: string;
  details?: { field: string; message: string }[];
}

class ApiFailure extends Error {
  constructor(readonly status: number, readonly code: string | undefined, message: string) {
    super(message);
  }
}

async function admin<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  const json: Envelope<T> = text ? JSON.parse(text) : {};

  if (!res.ok || json.success === false) {
    const detail = json.details?.length
      ? `${json.message} — ${json.details.map((d) => `${d.field}: ${d.message}`).join('; ')}`
      : (json.message ?? `HTTP ${res.status}`);
    throw new ApiFailure(res.status, json.code, detail);
  }

  return json.data as T;
}

// ─── Content ────────────────────────────────────────────────────────────────

const NPC_ITEM_TYPE = 'bramble';
const FENNEC_ITEM_TYPE = 'fennec_fox';
const TEAGAN_ITEM_TYPE = 'mrs_teagan';
const TOWN_SCENE_SLUG = 'town';

/** Bramble is the farm questline's giver: a hedgehog gardener who lives on your farm. */
const npc = {
  itemType: NPC_ITEM_TYPE,
  label: 'Bramble',
  emoji: '🦔',
  color: '#8a6b4f',
  category: 'npc' as const,
  placeable: true,
  cols: 3,
  rows: 3,
  sellable: false,
  buyable: false,
  // Shown when he has no quest business — the fallback so tapping him always answers.
  npcDialog: [
    { text: 'Soil looks happy today. Keep it damp and it will keep you fed.' },
    { text: "I've been gardening these hills since before the fence went up." },
    { text: 'Wheat first, always. Everything else is a luxury.' },
  ],
};

/** Fennec teaches fishing in town once the farm reaches level 2. */
const fennecNpc = {
  itemType: FENNEC_ITEM_TYPE,
  label: 'Fennec',
  emoji: '🦊',
  color: '#c48a3a',
  category: 'npc' as const,
  placeable: true,
  cols: 3,
  rows: 3,
  sellable: false,
  buyable: false,
  // Reuse the fisherman art already on the town map.
  imageUrl:
    'https://images.hatchly.me/game-items/fennec_fox_fisherman/6c242ab2-e4ba-4d17-89a1-e0e9186ba007.png',
  npcDialog: [
    { text: 'The water talks if you listen long enough. Mostly about fish.' },
    { text: 'Cast gentle. Panic and they swim circles around you.' },
    { text: 'Town pond, river, ocean — every spot has its own mood.' },
  ],
};

/** Mrs. Teagan teaches cooking recipes. Def + quests only — not auto-placed. */
const teaganNpc = {
  itemType: TEAGAN_ITEM_TYPE,
  label: 'Mrs. Teagan',
  emoji: '🐄',
  color: '#f5e6d3',
  category: 'npc' as const,
  placeable: true,
  cols: 3,
  rows: 3,
  sellable: false,
  buyable: false,
  npcDialog: [
    { text: 'A kitchen without a recipe scroll is just a warm box. Learn first, then stir.' },
    { text: 'Salt is courage. Patience is butter. Write that down.' },
    { text: 'When the pot sings, you listen. When it sulks, you add water.' },
  ],
};

const NPC_ART_PROMPT =
  'A single friendly hedgehog gardener character standing upright, wearing a straw sun hat and a ' +
  'small green apron, holding a tiny watering can, 2D game sprite for a cozy top-down farming game. ' +
  'Soft warm palette, rounded shapes, clean thick outlines, front-facing three-quarter view, ' +
  'centered, transparent background, no shadow, no text.';

const TEAGAN_ART_PROMPT =
  'A single friendly anthropomorphic cow girl chef character standing upright, cream and soft brown ' +
  'cow markings, gentle smile, wearing a white chef hat and a warm apron with a wooden spoon, ' +
  '2D game sprite for a cozy top-down farming game. Soft warm palette, rounded shapes, clean thick ' +
  'outlines, front-facing three-quarter view, centered, transparent background, no shadow, no text.';

/** Handed to the admin's inventory so every authored quest is reachable today. */
const TEST_KIT: { itemType: string; qty: number }[] = [
  { itemType: 'soil', qty: 3 },
  { itemType: 'wheat_seed', qty: 15 },
  { itemType: 'carrot_seed', qty: 10 },
  { itemType: 'pumpkin_seed', qty: 5 },
  { itemType: 'sugar_cane_seed', qty: 3 },
  { itemType: 'water', qty: 5 },
  { itemType: 'stick', qty: 20 },
  { itemType: 'stone', qty: 20 },
  { itemType: 'cooking_pot', qty: 1 },
  { itemType: 'well', qty: 1 },
  { itemType: 'pet_food_dish', qty: 1 },
  { itemType: 'tree_sappling_oak_apple', qty: 2 },
];

/**
 * Retired pet story quests and older ladders — delete on reseed so they stop
 * auto-opening beside the Bramble chain.
 */
const OBSOLETE_QUEST_IDS = [
  'sprout_orchard',
  'sprout_bug_net',
  'sprout_market',
  'budding_well',
  'budding_pumpkins',
  'budding_feast',
  'starter_first_crop',
  'starter_craft_bench',
  'starter_bug_hunt',
  'starter_stick_axe',
  'starter_fish_pole',
  'starter_kitchen',
  'starter_bread',
  'starter_craft_seat',
  'starter_well',
  'starter_water_crops',
  'bramble_water_crops',
  'starter_stone_upgrade',
  'starter_showpiece',
];

type Quest = Record<string, unknown> & { questId: string };

/**
 * Order matters: a quest that names another in `requiredQuestId` or a
 * `quest_complete` trigger is rejected until that one exists.
 */
const quests: Quest[] = [
  // ── Only pet story quest ──────────────────────────────────────────────────
  {
    questId: 'starter_tidy_yard',
    type: 'story',
    title: 'A Fresh Start',
    description: 'Pick up 5 sticks and 5 stones scattered around your new farm.',
    farmLevelMin: 1,
    sortOrder: 10,
    triggers: [{ type: 'start' }],
    requirements: {
      actions: [
        { action: 'pickup_ground', itemType: 'stick', count: 5 },
        { action: 'pickup_ground', itemType: 'stone', count: 5 },
      ],
    },
    rewards: { gems: 40, xp: 15 },
    startDialogSpeaker: 'pet',
    startDialog: [
      { text: 'We have a home! I am so happy… even if it is a little messy out here.' },
      {
        text: 'Sticks and stones everywhere. Grab five of each — that is enough for now!',
      },
    ],
    endDialogSpeaker: 'pet',
    endDialog: [
      {
        text: 'Ahh, much better. Fresh sticks and stones will show up each day — let’s keep our yard tidy together!',
      },
      {
        text: 'Oh! Someone fuzzy is living by the hedge. Tap them and say hello — I bet they know this hill best.',
      },
    ],
  },

  {
    questId: 'pet_farm_board',
    type: 'story',
    title: 'Check the Farm Board',
    description: 'Open your farm info board to see your level, XP, and upgrade path.',
    farmLevelMin: 1,
    requiredQuestId: 'starter_tidy_yard',
    sortOrder: 12,
    triggers: [{ type: 'quest_complete', questId: 'starter_tidy_yard' }],
    requirements: {
      open_modal: [{ payload: 'farm_info', count: 1 }],
    },
    rewards: { gems: 25, xp: 10 },
    startDialogSpeaker: 'pet',
    startDialog: [
      {
        text: 'Before we get lost in weeds — tap the farm badge up top! That board shows our level and how close we are to a bigger yard.',
        highlight: { type: 'hud_button', target: 'farm_info' },
      },
    ],
    progressDialogSpeaker: 'pet',
    progressDialog: [
      {
        text: 'Still need a peek at the farm board? Tap the level badge at the top of the screen.',
      },
    ],
    endDialogSpeaker: 'pet',
    endDialog: [
      {
        text: 'See? XP, level, the whole plan. Now go say hi to that hedge neighbour!',
      },
    ],
  },

  // ── Bramble story ladder ──────────────────────────────────────────────────
  {
    questId: 'bramble_meet',
    type: 'story',
    title: 'The Neighbour in the Hedge',
    description: 'Somebody has been living at the edge of your farm. Go say hello.',
    farmLevelMin: 1,
    requiredQuestId: 'starter_tidy_yard',
    sortOrder: 20,
    triggers: [{ type: 'talk_to_npc', npcItemType: NPC_ITEM_TYPE }],
    requirements: { talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }] },
    rewards: { gems: 50, xp: 20, items: [{ itemType: 'soil', qty: 1 }, { itemType: 'wheat_seed', qty: 5 }] },
    startDialogSpeaker: 'npc',
    startDialog: [
      { text: 'Oh! Hello there. Careful of the prickles — they are friendlier than they look.', speaker: 'npc' },
      { text: 'Hi! We just moved in. The yard was very sticky and stony… but we cleaned it!', speaker: 'pet' },
      { text: 'Ha! I am Bramble. I have tended a little garden on this hill for a long, long time.', speaker: 'npc' },
      { text: 'A neighbour! Do you know what we should grow first?', speaker: 'pet' },
      { text: 'Wheat, always wheat. It feeds you, it feeds friends, and it smells like home.', speaker: 'npc' },
      { text: 'Wheat it is! Thank you, Bramble. We will come visit again soon.', speaker: 'pet' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Take this soil and these wheat seeds. Welcome to the hill — grow something kind.', speaker: 'npc' },
      { text: 'Wheat it is! I will let Bramble show us how.', speaker: 'pet' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'Still getting settled? Come tap me again when you are ready to chat — I will wait right here in the hedge.',
      },
    ],
  },
  {
    questId: 'bramble_first_crop',
    type: 'story',
    title: 'Wheat for the Hill',
    description: 'Place soil, sow and harvest wheat×3, then return to Bramble.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_meet',
    sortOrder: 30,
    triggers: [{ type: 'quest_complete', questId: 'bramble_meet' }],
    requirements: {
      buildings: [{ itemType: 'soil', count: 1 }],
      actions: [
        { action: 'place', itemType: 'wheat_seed', count: 3 },
        { action: 'harvest', itemType: 'wheat', count: 3 },
      ],
      talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }],
    },
    rewards: {
      gems: 60,
      xp: 20,
      items: [
        { itemType: 'primitive_crafting_table', qty: 1 },
        { itemType: 'recipe_stick_net', qty: 1 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        // inventory_item steps to the backpack button until it is open, then
        // waits for an actual place of this item — not merely opening the bag.
        text: 'First, open your backpack and place a patch of soil on the farm.',
        highlight: { type: 'inventory_item', target: 'soil' },
      },
      {
        text: 'Good. Now plant wheat seeds on that soil — I would love three ears when they are ready.',
        highlight: { type: 'inventory_item', target: 'wheat_seed' },
      },
      {
        text: 'Harvest three wheat, then come tap me again. I will be right here in the hedge.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: "Still working on those three wheat? Soil first from your backpack, then seeds on top. Come back when you have harvested three.",
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'Three beautiful ears! Here — a little crafting table and a Stick Net recipe scroll. Learn the scroll, then come back.',
      },
    ],
  },
  {
    questId: 'bramble_bug_net',
    type: 'story',
    title: 'A Net for Busy Wings',
    description: 'Learn the Stick Net, place your crafting table, craft and equip the net, catch three bugs, then return to Bramble.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_first_crop',
    sortOrder: 40,
    triggers: [{ type: 'quest_complete', questId: 'bramble_first_crop' }],
    requirements: {
      buildings: [{ itemType: 'primitive_crafting_table', count: 1 }],
      open_modal: [{ payload: 'crafting', count: 1 }],
      actions: [
        { action: 'learn', itemType: 'recipe_stick_net', count: 1 },
        { action: 'craft', itemType: 'stick_net', count: 1 },
        { action: 'catch', count: 3 },
      ],
      equips: [{ slot: 'handTool', itemType: 'stick_net' }],
      talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }],
    },
    rewards: {
      gems: 100,
      xp: 30,
      items: [
        { itemType: 'stick', qty: 20 },
        { itemType: 'recipe_storage', qty: 1 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'First, tap the Stick Net recipe scroll in your backpack to learn it.',
        highlight: { type: 'inventory_item', target: 'recipe_stick_net' },
      },
      {
        text: 'Now place the crafting table from your backpack onto the farm.',
        highlight: { type: 'inventory_item', target: 'primitive_crafting_table' },
      },
      {
        text: 'Tap your crafting table to open it.',
        highlight: { type: 'world_item', target: 'primitive_crafting_table' },
      },
      {
        text: 'Craft a Stick Net at the table.',
        highlight: { type: 'craft_item', target: 'stick_net' },
      },
      {
        text: 'Equip the Stick Net — open your tools and put it in your hand.',
        highlight: { type: 'equip_item', target: 'stick_net' },
      },
      {
        text: 'Catch three little bugs for me, then hop back to the hedge. They keep my garden honest.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'Still working on that net? Learn the scroll, place the table, craft and equip the net, then catch three bugs.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'Three catches! Splendid. Your pockets will overflow soon — take this Storage recipe scroll and those sticks.',
      },
    ],
  },
  {
    questId: 'pet_equip_tour',
    type: 'story',
    title: 'Tools in Hand',
    description: 'Open the equip panel and peek at what you can hold.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_bug_net',
    sortOrder: 41,
    triggers: [{ type: 'quest_complete', questId: 'bramble_bug_net' }],
    requirements: {
      open_modal: [{ payload: 'equip', count: 1 }],
    },
    rewards: { gems: 30, xp: 10 },
    startDialogSpeaker: 'pet',
    startDialog: [
      {
        text: 'Psst — tap the equip button! That is where nets, poles, and axes live when they are not in your hand.',
        highlight: { type: 'hud_button', target: 'equip' },
      },
    ],
    progressDialogSpeaker: 'pet',
    progressDialog: [
      { text: 'Open the equip panel once — the little tool button on the toolbar.' },
    ],
    endDialogSpeaker: 'pet',
    endDialog: [
      { text: 'Handy, right? Swap tools anytime before you dig, fish, or catch.' },
    ],
  },
  {
    questId: 'pet_bestiary_peek',
    type: 'story',
    title: 'A Book of Bugs',
    description: 'Open the museum / bestiary to see what you have caught.',
    farmLevelMin: 1,
    requiredQuestId: 'pet_equip_tour',
    sortOrder: 42,
    triggers: [{ type: 'quest_complete', questId: 'pet_equip_tour' }],
    requirements: {
      open_modal: [{ payload: 'bestiary', count: 1 }],
    },
    rewards: { gems: 30, xp: 10 },
    startDialogSpeaker: 'pet',
    startDialog: [
      {
        text: 'We caught bugs! Tap the book button — the museum remembers every flutter and fin.',
        highlight: { type: 'hud_button', target: 'bestiary' },
      },
    ],
    progressDialogSpeaker: 'pet',
    progressDialog: [
      { text: 'Still need a peek at the museum book? Tap the book icon on the toolbar.' },
    ],
    endDialogSpeaker: 'pet',
    endDialog: [
      { text: 'Look at us — collectors already. Bramble will want that storage next.' },
    ],
  },
  {
    questId: 'bramble_storage',
    type: 'story',
    title: 'Room to Grow',
    description: 'Learn the Storage recipe, craft a Storage box, place it on your farm, then return to Bramble.',
    farmLevelMin: 1,
    requiredQuestId: 'pet_bestiary_peek',
    sortOrder: 45,
    triggers: [{ type: 'quest_complete', questId: 'pet_bestiary_peek' }],
    requirements: {
      buildings: [{ itemType: 'storage', count: 1 }],
      actions: [
        { action: 'learn', itemType: 'recipe_storage', count: 1 },
        { action: 'craft', itemType: 'storage', count: 1 },
      ],
      talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }],
    },
    rewards: {
      gems: 80,
      xp: 20,
      items: [
        { itemType: 'stick', qty: 8 },
        { itemType: 'recipe_stick_shovel', qty: 1 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Tap the Storage recipe scroll in your backpack to learn it.',
        highlight: { type: 'inventory_item', target: 'recipe_storage' },
      },
      {
        text: 'Craft a Storage box at your crafting table — it takes sticks.',
        highlight: { type: 'craft_item', target: 'storage' },
      },
      {
        text: 'Place the Storage box somewhere handy on your farm.',
        highlight: { type: 'inventory_item', target: 'storage' },
      },
      {
        text: 'When it is set, hop back to the hedge. Your backpack only holds so much — storage never fills.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'Still need that Storage box? Learn the scroll, craft it at the table, place it on your farm, then tap me again.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'Perfect — a proper vault. Take this Stick Shovel scroll next; those dig spots will not open themselves.',
      },
    ],
  },
  {
    questId: 'bramble_storage_stash',
    type: 'story',
    title: 'Fill the Vault',
    description: 'Open your Storage box and get comfortable moving things out of a full backpack.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_storage',
    sortOrder: 47,
    triggers: [{ type: 'quest_complete', questId: 'bramble_storage' }],
    requirements: {
      open_modal: [{ payload: 'storage', count: 1 }],
      talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }],
    },
    rewards: { gems: 40, xp: 12 },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Tap the Storage box you placed — tuck something away, then pull it back. Backpack slots are precious.',
        highlight: { type: 'world_item', target: 'storage' },
      },
      {
        text: 'When you have opened it once, come tell me. Digging waits after that shovel scroll.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'Open your Storage box on the farm, then tap me again.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'Good habit. Overflow goes in the vault — never leave sticks crying on the path.',
      },
    ],
  },
  {
    questId: 'bramble_shovel',
    type: 'story',
    title: 'Two Soft Spots',
    description: 'Learn the Stick Shovel, craft and equip it, dig up both dig spots on your farm, then return to Bramble.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_storage_stash',
    sortOrder: 50,
    triggers: [{ type: 'quest_complete', questId: 'bramble_storage_stash' }],
    requirements: {
      actions: [
        { action: 'learn', itemType: 'recipe_stick_shovel', count: 1 },
        { action: 'craft', itemType: 'stick_shovel', count: 1 },
        { action: 'dig_fossil', count: 2 },
      ],
      equips: [{ slot: 'handTool', itemType: 'stick_shovel' }],
      talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }],
    },
    rewards: {
      gems: 90,
      xp: 25,
      items: [
        { itemType: 'stick', qty: 6 },
        { itemType: 'recipe_stick_axe', qty: 1 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Tap the Stick Shovel recipe scroll in your backpack to learn it.',
        highlight: { type: 'inventory_item', target: 'recipe_stick_shovel' },
      },
      {
        text: 'Craft a Stick Shovel at your crafting table.',
        highlight: { type: 'craft_item', target: 'stick_shovel' },
      },
      {
        text: 'Equip the shovel in your hand.',
        highlight: { type: 'equip_item', target: 'stick_shovel' },
      },
      {
        text: 'Dig up both soft spots on your plot — tap each little hole with the shovel ready.',
        highlight: { type: 'world_item', target: 'fossil_hole' },
      },
      {
        text: 'When both are dug, hop back to the hedge and tell me what you found.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'Still digging? Learn the shovel scroll, craft and equip it, then clear both dig spots on your farm.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Treasure from dirt — my favourite kind. Take this Stick Axe recipe next.' },
    ],
  },
  {
    questId: 'bramble_tools',
    type: 'story',
    title: 'A Proper Axe',
    description: 'Learn the Stick Axe recipe, craft one, then return to Bramble.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_shovel',
    sortOrder: 60,
    triggers: [{ type: 'quest_complete', questId: 'bramble_shovel' }],
    requirements: {
      actions: [
        { action: 'learn', itemType: 'recipe_stick_axe', count: 1 },
        { action: 'craft', itemType: 'stick_axe', count: 1 },
      ],
      talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }],
    },
    rewards: {
      gems: 90,
      xp: 25,
      items: [
        { itemType: 'recipe_stick_pickaxe', qty: 1 },
        { itemType: 'carrot_seed', qty: 5 },
        { itemType: 'stick', qty: 6 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Tap the Stick Axe recipe scroll in your backpack to learn it.',
        highlight: { type: 'inventory_item', target: 'recipe_stick_axe' },
      },
      {
        text: 'Tap your crafting table to open it.',
        highlight: { type: 'world_item', target: 'primitive_crafting_table' },
      },
      {
        text: 'Craft a Stick Axe, then come show me.',
        highlight: { type: 'craft_item', target: 'stick_axe' },
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'Still need that axe? Learn the scroll in your backpack, craft it at the table, then tap me again.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'Sharp enough! A pickaxe scroll for later, and carrot seeds for now. When your farm grows, town has a well for cooking water.',
      },
    ],
  },
  {
    questId: 'bramble_pickaxe_craft',
    type: 'story',
    title: 'Stone Underfoot',
    description: 'Learn and craft a Stick Pickaxe, equip it, then return to Bramble.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_tools',
    sortOrder: 62,
    triggers: [{ type: 'quest_complete', questId: 'bramble_tools' }],
    requirements: {
      actions: [
        { action: 'learn', itemType: 'recipe_stick_pickaxe', count: 1 },
        { action: 'craft', itemType: 'stick_pickaxe', count: 1 },
      ],
      equips: [{ slot: 'handTool', itemType: 'stick_pickaxe' }],
      talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }],
    },
    rewards: { gems: 70, xp: 20, items: [{ itemType: 'stone', qty: 10 }] },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Tap that Stick Pickaxe scroll in your backpack and learn it.',
        highlight: { type: 'inventory_item', target: 'recipe_stick_pickaxe' },
      },
      {
        text: 'Craft the pickaxe at your table, equip it, then show me. Ore veins wait in town later — the tool comes first.',
        highlight: { type: 'craft_item', target: 'stick_pickaxe' },
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'Learn the pickaxe scroll, craft and equip it, then tap me again.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'Solid work. Keep it handy for rocky places. Carrots still need growing for my stew, mind you.',
      },
    ],
  },
  {
    questId: 'bramble_delivery',
    type: 'story',
    title: "Bramble's Carrots",
    description: 'Grow and bring Bramble three carrots.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_pickaxe_craft',
    sortOrder: 70,
    triggers: [{ type: 'quest_complete', questId: 'bramble_pickaxe_craft' }],
    requirements: {
      items: [{ itemType: 'carrot', qty: 3 }],
      talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }],
    },
    rewards: {
      gems: 120,
      xp: 30,
      items: [
        { itemType: 'carrot_seed', qty: 3 },
        { itemType: 'pet_food_dish', qty: 1 },
        { itemType: 'apple', qty: 3 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Plant those carrot seeds from your backpack — soil first if you need a new patch.',
        highlight: { type: 'inventory_item', target: 'carrot_seed' },
      },
      {
        text: 'Grow three carrots and bring them over. Orange is a cheerful colour for a hedge.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'I am still waiting on three carrots. Soil, seeds, a little water — then tap me when your bag is full.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Three bright carrots — thank you. You have a kind heart for farming.' },
      {
        text: 'Your friend gets hungry too. Take this food dish and a few apples — I will show you how to use them next.',
        highlight: { type: 'inventory_item', target: 'pet_food_dish' },
      },
    ],
  },
  {
    questId: 'bramble_pet_bowl',
    type: 'story',
    title: 'A Bowl by the Path',
    description:
      'Place a pet food dish, open it, add food, wait for your pet to eat, then return to Bramble.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_delivery',
    sortOrder: 75,
    triggers: [{ type: 'quest_complete', questId: 'bramble_delivery' }],
    requirements: {
      buildings: [{ itemType: 'pet_food_dish', count: 1 }],
      open_modal: [{ payload: 'food_dish', count: 1 }],
      actions: [{ action: 'feed_pet', count: 1 }],
      talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }],
    },
    rewards: {
      gems: 80,
      xp: 25,
      items: [
        { itemType: 'cooking_pot', qty: 1 },
        { itemType: 'well', qty: 1 },
        { itemType: 'recipe_flour', qty: 1 },
        { itemType: 'recipe_bread_dough', qty: 1 },
        { itemType: 'recipe_bread', qty: 1 },
        { itemType: 'apple', qty: 2 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'First, open your backpack and place the pet food dish somewhere your friend walks.',
        highlight: { type: 'inventory_item', target: 'pet_food_dish' },
      },
      {
        text: 'Good. Now tap the dish on your farm to open it.',
        highlight: { type: 'world_item', target: 'pet_food_dish' },
      },
      {
        text: 'Drop an apple into the dish — only food goes here, not crops like wheat.',
        highlight: { type: 'food_dish_item', target: 'apple' },
      },
      {
        text: 'Wait for your pet to wander over and take a bite. When they snack, hop back to the hedge.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'Still hungry out there? Place the dish, tap it, add an apple, then wait for a nibble before you tap me.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'Happy tummies make happy farms. Keep that dish stocked — empty bowls mean a sad friend.',
      },
      {
        text: 'Now you are ready for a kitchen. Take this cooking pot, a well, and three recipe scrolls — Flour, Bread Dough, and Bread. Learn each scroll before you cook.',
        highlight: { type: 'inventory_item', target: 'cooking_pot' },
      },
    ],
  },
  // Kitchen used to wait for farm level 2 (town well). A home well ships with the cooking kit.
  {
    questId: 'bramble_kitchen',
    type: 'story',
    title: 'Something Warm',
    description:
      'Learn your cooking scrolls, collect well water, place the pot, mill flour, make dough, bake bread, then return to Bramble.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_pet_bowl',
    sortOrder: 85,
    triggers: [{ type: 'quest_complete', questId: 'bramble_pet_bowl' }],
    requirements: {
      buildings: [{ itemType: 'cooking_pot', count: 1 }],
      open_modal: [{ payload: 'cooking', count: 1 }],
      actions: [
        { action: 'collect_water', count: 1 },
        { action: 'cook', itemType: 'flour', count: 1 },
        { action: 'cook', itemType: 'bread_dough', count: 1 },
        { action: 'cook', itemType: 'bread', count: 1 },
      ],
      talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }],
    },
    rewards: {
      gems: 100,
      xp: 30,
      items: [
        { itemType: 'water', qty: 3 },
        { itemType: 'recipe_sliced_carrots', qty: 1 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Tap the Flour, Bread Dough, and Bread scrolls in your backpack to learn them — cooking only works for recipes you know.',
        highlight: { type: 'inventory_item', target: 'recipe_flour' },
      },
      {
        text: 'Place the well from your backpack, then tap it for a bucket of water.',
        highlight: { type: 'inventory_item', target: 'well' },
      },
      {
        text: 'Place the cooking pot from your backpack onto the farm.',
        highlight: { type: 'inventory_item', target: 'cooking_pot' },
      },
      {
        text: 'Open the pot, mill wheat into flour (two wheat), then make dough, then bake bread.',
        highlight: { type: 'cook_item', target: 'flour' },
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'Learn the scrolls, fetch water, then cook flour → dough → bread. Come back when a loaf is done.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'It smells like home already. Here is a Sliced Carrots scroll — learn it if you want a side for our feast.',
        highlight: { type: 'inventory_item', target: 'recipe_sliced_carrots' },
      },
    ],
  },
  {
    questId: 'bramble_sliced_side',
    type: 'story',
    title: 'Something on the Side',
    description: 'Learn the sliced carrots recipe and cook a plate to go with your bread.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_kitchen',
    sortOrder: 87,
    triggers: [{ type: 'quest_complete', questId: 'bramble_kitchen' }],
    requirements: {
      actions: [{ action: 'cook', itemType: 'sliced_carrots', count: 1 }],
      talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }],
    },
    rewards: { gems: 50, xp: 15, items: [{ itemType: 'carrot', qty: 2 }] },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Learn the Sliced Carrots scroll from your backpack, then cook it at the pot — two carrots.',
        highlight: { type: 'inventory_item', target: 'recipe_sliced_carrots' },
      },
      {
        text: 'Keep the plate. We will sit down properly when you bring bread and sliced carrots together.',
        highlight: { type: 'cook_item', target: 'sliced_carrots' },
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'Still need sliced carrots? Learn the scroll, cook two carrots, then tap me again.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'Orange and warm. Bring that plate with a loaf when you are ready for a thank-you feast.',
      },
    ],
  },
  {
    questId: 'bramble_feast',
    type: 'story',
    title: 'A Proper Thank-You',
    description: 'Bring Bramble a cooked meal: one loaf of bread and a plate of sliced carrots.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_sliced_side',
    sortOrder: 90,
    triggers: [{ type: 'quest_complete', questId: 'bramble_sliced_side' }],
    requirements: {
      items: [{ itemType: 'bread', qty: 1 }, { itemType: 'sliced_carrots', qty: 1 }],
      talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }],
    },
    rewards: { gems: 300, xp: 60, items: [{ itemType: 'cat_fish_plushie', qty: 1 }] },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Cook sliced carrots to go with your bread, then bring the meal here. We will sit a moment.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'Mmm, I can almost smell something cooking… come back when you have a loaf of bread and a plate of sliced carrots for us to share.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Oh my. A warm meal. Please, sit with me a moment.' },
      { text: 'Here — a little keepsake. It will look happier on your porch than in my hedge.' },
    ],
  },

  // ── Post-feast basics (short lessons) ─────────────────────────────────────
  {
    questId: 'bramble_sell_lesson',
    type: 'story',
    title: 'Coins for the Hill',
    description: 'Open your Sell Box and sell three wheat.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_feast',
    sortOrder: 95,
    triggers: [{ type: 'quest_complete', questId: 'bramble_feast' }],
    requirements: {
      open_modal: [{ payload: 'sell_box', count: 1 }],
      actions: [{ action: 'sell', itemType: 'wheat', count: 3 }],
      talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }],
    },
    rewards: { gems: 60, xp: 20 },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Extra wheat earns coins. Tap your Sell Box on the farm.',
        highlight: { type: 'world_item', target: 'sell_box' },
      },
      {
        text: 'Sell three wheat, then hop back to the hedge.',
        highlight: { type: 'sell_item', target: 'wheat' },
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      { text: 'Open the Sell Box and sell three wheat, then tap me again.' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'Coins jingle nicely. Keep selling extras when your bags get heavy.',
      },
    ],
  },
  {
    questId: 'bramble_mail_check',
    type: 'story',
    title: 'Letters by the Door',
    description: 'Open your Mail Box once to see how gifts and notes arrive.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_sell_lesson',
    sortOrder: 100,
    triggers: [{ type: 'quest_complete', questId: 'bramble_sell_lesson' }],
    requirements: {
      open_modal: [{ payload: 'mail_box', count: 1 }],
      talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }],
    },
    rewards: {
      gems: 35,
      xp: 10,
      items: [{ itemType: 'tree_sappling_oak_apple', qty: 1 }],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Tap the Mail Box by your house — that is how parcels find you later.',
        highlight: { type: 'world_item', target: 'mail_box' },
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      { text: 'Open the Mail Box once, then come back to the hedge.' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'Empty today is fine. When something arrives, you will know where to look. Take this oak sapling for shade next.',
      },
    ],
  },
  {
    questId: 'bramble_orchard',
    type: 'story',
    title: 'Shade on the Hill',
    description: 'Plant an oak sapling and shake a tree for fruit.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_mail_check',
    sortOrder: 110,
    triggers: [{ type: 'quest_complete', questId: 'bramble_mail_check' }],
    requirements: {
      actions: [
        { action: 'place', itemType: 'tree_sappling_oak_apple', count: 1 },
        { action: 'shake_tree', count: 1 },
      ],
      talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }],
    },
    rewards: {
      gems: 70,
      xp: 20,
      items: [
        { itemType: 'stick', qty: 8 },
        { itemType: 'well', qty: 1 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Plant that oak sapling from your backpack on open grass.',
        highlight: { type: 'inventory_item', target: 'tree_sappling_oak_apple' },
      },
      {
        text: 'When a tree is grown enough, tap it to shake — fruit and sticks fall free. One good shake, then return.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'Plant a sapling and shake a tree once. Fully grown oaks are easiest.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'Leaves in your hair already. Take this well for home water — we will place it next.',
      },
    ],
  },
  {
    questId: 'bramble_home_well',
    type: 'story',
    title: 'Water at Home',
    description: 'Place a well on your farm and collect water from it.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_orchard',
    sortOrder: 115,
    triggers: [{ type: 'quest_complete', questId: 'bramble_orchard' }],
    requirements: {
      buildings: [{ itemType: 'well', count: 1 }],
      actions: [{ action: 'collect_water', count: 1 }],
      talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }],
    },
    rewards: { gems: 55, xp: 15, items: [{ itemType: 'water', qty: 5 }] },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Town wells are fine, but a home well is kinder. Place a well from your backpack.',
      },
      {
        text: 'Tap it and collect a bucket. Then come back — no more long walks for every loaf.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      { text: 'Place a well and collect water once, then tap me.' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Listen — that splash means independence. More water for your bag.' },
    ],
  },
  {
    questId: 'bramble_porch_plush',
    type: 'story',
    title: 'Porch Pride',
    description: 'Place the Cat Fish Plushie somewhere you can see it.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_home_well',
    sortOrder: 120,
    triggers: [{ type: 'quest_complete', questId: 'bramble_home_well' }],
    requirements: {
      buildings: [{ itemType: 'cat_fish_plushie', count: 1 }],
      talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }],
    },
    rewards: { gems: 80, xp: 20, items: [{ itemType: 'pumpkin_seed', qty: 5 }, { itemType: 'sugar_cane_seed', qty: 5 }] },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'That plushie from our feast — place it from your backpack. Porches need personality.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      { text: 'Still in the bag? Place the Cat Fish Plushie, then tap me.' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'Charming. Pumpkin and sugar-cane seeds for whenever you want a longer project — no rush.',
      },
    ],
  },

  // ── Longer Bramble side quests (take your time) ───────────────────────────
  {
    questId: 'bramble_pumpkin_patch',
    type: 'story',
    title: 'Orange Giants',
    description: 'Grow and harvest three pumpkins — a slower crop for patient farmers.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_porch_plush',
    sortOrder: 200,
    triggers: [{ type: 'quest_complete', questId: 'bramble_porch_plush' }],
    requirements: {
      actions: [{ action: 'harvest', itemType: 'pumpkin', count: 3 }],
      talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }],
    },
    rewards: {
      gems: 150,
      xp: 40,
      items: [
        { itemType: 'pumpkin_seed', qty: 3 },
        { itemType: 'recipe_sugar', qty: 1 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Pumpkins take their time. Plant the seeds I gave you, water them, and bring me three harvests when they are ready — days are fine.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'Still waiting on three pumpkins? No hurry. Soil, seeds, water, harvest — then tap me.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Heavy and honest. Soup and pie live in these. Keep a few seeds for next season.' },
      {
        text: 'And a Sugar recipe scroll — you will need it for sweets.',
      },
    ],
  },
  {
    questId: 'bramble_sugar_run',
    type: 'story',
    title: 'Sweet Stalks',
    description: 'Learn the sugar recipe, harvest three sugar cane, and cook sugar.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_pumpkin_patch',
    sortOrder: 205,
    triggers: [{ type: 'quest_complete', questId: 'bramble_pumpkin_patch' }],
    requirements: {
      actions: [
        { action: 'harvest', itemType: 'sugar_cane', count: 3 },
        { action: 'cook', itemType: 'sugar', count: 1 },
      ],
      talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }],
    },
    rewards: {
      gems: 100,
      xp: 30,
      items: [
        { itemType: 'sugar', qty: 2 },
        { itemType: 'recipe_pumpkin_pie', qty: 1 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Learn the Sugar scroll, then grow three sugar cane stalks and cook them into sugar.',
      },
      {
        text: 'One jar of sugar is enough to prove the point.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'Harvest three sugar cane and cook sugar once. Come back when the jar is ready.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'Sweet work. Here is a Pumpkin Pie scroll for whenever you are ready.',
      },
    ],
  },
  {
    questId: 'bramble_pie_day',
    type: 'story',
    title: 'A Slice of Patience',
    description: 'Learn pumpkin pie, bake it (pumpkin + sugar), and bring it to Bramble.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_sugar_run',
    sortOrder: 210,
    triggers: [{ type: 'quest_complete', questId: 'bramble_sugar_run' }],
    requirements: {
      actions: [{ action: 'cook', itemType: 'pumpkin_pie', count: 1 }],
      items: [{ itemType: 'pumpkin_pie', qty: 1 }],
      talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }],
    },
    rewards: { gems: 200, xp: 50, items: [{ itemType: 'watermelon_seeds', qty: 2 }] },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Learn the Pumpkin Pie scroll, then bake one pumpkin with one sugar.',
      },
      {
        text: 'Bring the finished pie here. We will pretend it is a holiday.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'Still baking? Learn the scroll, then one pumpkin, one sugar, one pie. Tap me when it is done.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Oh. Crust and spice. You have made this hill smell like celebration.' },
      { text: 'Take these watermelon seeds when you want a longer crop — no rush.' },
    ],
  },
  {
    questId: 'bramble_scarab_hunt',
    type: 'story',
    title: 'A Shell in the Grass',
    description: 'Catch a Grim Scarab — a rarer bug that takes luck and patience.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_pie_day',
    sortOrder: 215,
    triggers: [{ type: 'quest_complete', questId: 'bramble_pie_day' }],
    requirements: {
      actions: [{ action: 'catch', itemType: 'grim_scarab', count: 1 }],
      equips: [{ slot: 'handTool', itemType: 'stick_net' }],
      talk_to_npc: [{ npcItemType: NPC_ITEM_TYPE, count: 1 }],
    },
    rewards: { gems: 180, xp: 45, items: [{ itemType: 'stick', qty: 10 }] },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Not every bug is a mosquito. Keep your Stick Net ready and watch for a Grim Scarab — dark shell, slow walk. It may take days.',
      },
      {
        text: 'Catch one and bring the news. No shame if the grass stays quiet awhile.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'Still hunting that Grim Scarab? Net equipped, eyes on the grass. Tap me when you have one.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'There it is — little night armour. The museum will be proud of you.' },
      { text: 'This hill is yours now. I have my own garden to tend — you will find me in town if you miss the prickles.' },
    ],
  },
  {
    questId: 'bramble_watermelon_trial',
    type: 'story',
    title: 'Stripes in the Dirt',
    description: 'Grow and harvest two watermelons.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_pie_day',
    sortOrder: 220,
    triggers: [{ type: 'quest_complete', questId: 'bramble_pie_day' }],
    requirements: {
      actions: [{ action: 'harvest', itemType: 'watermelon', count: 2 }],
    },
    rewards: { gems: 220, xp: 55, items: [{ itemType: 'watermelon_seeds', qty: 2 }] },
    startDialogSpeaker: 'pet',
    startDialog: [
      {
        text: 'Watermelons like a long soak. Plant a couple of seeds and harvest two when they ripen.',
      },
    ],
    progressDialogSpeaker: 'pet',
    progressDialog: [
      {
        text: 'Two watermelons still? Big fruit, big wait. I will cheer when they are in the bag.',
      },
    ],
    endDialogSpeaker: 'pet',
    endDialog: [
      { text: 'Striped and heavy! Share one someday — or cook the slices if we get hungry.' },
    ],
  },
  {
    questId: 'bramble_shop_window',
    type: 'story',
    title: 'Town Shelves',
    description: 'Buy anything once from the shop — a small trip into town commerce.',
    farmLevelMin: 1,
    requiredQuestId: 'bramble_sell_lesson',
    sortOrder: 98,
    triggers: [{ type: 'quest_complete', questId: 'bramble_sell_lesson' }],
    requirements: {
      actions: [{ action: 'purchase', count: 1 }],
    },
    rewards: { gems: 40, xp: 15 },
    startDialogSpeaker: 'pet',
    startDialog: [
      {
        text: 'Tap the shop button and buy one little thing — seeds, decor, whatever catches your eye. Spend coins you earned.',
        highlight: { type: 'hud_button', target: 'shop' },
      },
    ],
    progressDialogSpeaker: 'pet',
    progressDialog: [
      { text: 'Purchase anything once from the shop — I will cheer when the bag jingles!' },
    ],
    endDialogSpeaker: 'pet',
    endDialog: [
      { text: 'Supporting the town shelves keeps the hill lively. Sensible shopping.' },
    ],
  },

  // ── Town: Fennec fishing (farm level 2+) ───────────────────────────────────
  {
    questId: 'fennec_meet',
    type: 'story',
    title: 'The Fox by the Water',
    description: 'Visit town and say hello to Fennec near the fishing shop.',
    farmLevelMin: 2,
    sortOrder: 155,
    triggers: [{ type: 'talk_to_npc', npcItemType: FENNEC_ITEM_TYPE }],
    requirements: { talk_to_npc: [{ npcItemType: FENNEC_ITEM_TYPE, count: 1 }] },
    rewards: {
      gems: 40,
      xp: 15,
      items: [{ itemType: 'recipe_stick_fishing_pole', qty: 1 }],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      { text: 'Oh! Fresh feet from the farms. I am Fennec — I watch the water more than I watch the clock.' },
      { text: 'You look like someone who could learn to cast. Tap me again when you are ready for a fishing lesson.' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      { text: 'Still shy? Tap me again when you want that fishing pole recipe.' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'Take this Stick Fishing Pole scroll. Learn it from your backpack when you are ready.',
      },
    ],
  },
  {
    questId: 'fennec_first_fish',
    type: 'story',
    title: 'First Cast',
    description: 'Learn and craft a Stick Fishing Pole, catch one fish, then return to Fennec in town.',
    farmLevelMin: 2,
    requiredQuestId: 'fennec_meet',
    sortOrder: 156,
    triggers: [{ type: 'quest_complete', questId: 'fennec_meet' }],
    requirements: {
      actions: [
        { action: 'craft', itemType: 'stick_fishing_pole', count: 1 },
        { action: 'catch', count: 1 },
      ],
      equips: [{ slot: 'handTool', itemType: 'stick_fishing_pole' }],
      talk_to_npc: [{ npcItemType: FENNEC_ITEM_TYPE, count: 1 }],
    },
    rewards: { gems: 120, xp: 35, items: [{ itemType: 'stick', qty: 4 }] },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Tap the Stick Fishing Pole scroll in your backpack to learn it.',
        highlight: { type: 'inventory_item', target: 'recipe_stick_fishing_pole' },
      },
      {
        text: 'Open your crafting table and craft the pole.',
      },
      {
        text: 'Craft the Stick Fishing Pole.',
      },
      {
        text: 'Equip the pole, then cast into any fishing water. One catch is enough for today.',
        highlight: { type: 'equip_item', target: 'stick_fishing_pole' },
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'No fish yet? Learn the scroll, craft and equip the pole, then try the town water or a fishing spot.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'A real catch! The water likes you. Come fish with me whenever the farm can spare you.' },
    ],
  },

  // ── Longer Fennec side quests (specific fish & patience) ──────────────────
  {
    questId: 'fennec_sell_catch',
    type: 'story',
    title: 'Coins from the River',
    description: 'Sell three Trout at your Sell Box, then tell Fennec.',
    farmLevelMin: 2,
    requiredQuestId: 'fennec_first_fish',
    sortOrder: 230,
    triggers: [{ type: 'quest_complete', questId: 'fennec_first_fish' }],
    requirements: {
      actions: [{ action: 'sell', itemType: 'trout', count: 3 }],
      talk_to_npc: [{ npcItemType: FENNEC_ITEM_TYPE, count: 1 }],
    },
    rewards: {
      gems: 80,
      xp: 25,
      items: [
        { itemType: 'stick', qty: 6 },
        { itemType: 'recipe_cooked_trout', qty: 1 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Extra Trout buy more line time. Catch a few, then sell three Trout from your Sell Box.',
      },
      {
        text: 'Keep one for the skillet later if you like — but three sales first.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      { text: 'Still need three Trout sold. Cast, sell, then tap me.' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'Smart casting. Take this Cooked Trout scroll — learn it before you heat the pan.',
      },
    ],
  },
  {
    questId: 'fennec_goldfish_wish',
    type: 'story',
    title: 'A Flash of Gold',
    description: 'Catch a Goldfish — small, bright, and a little elusive.',
    farmLevelMin: 2,
    requiredQuestId: 'fennec_first_fish',
    sortOrder: 235,
    triggers: [{ type: 'quest_complete', questId: 'fennec_first_fish' }],
    requirements: {
      actions: [{ action: 'catch', itemType: 'goldfish', count: 1 }],
      equips: [{ slot: 'handTool', itemType: 'stick_fishing_pole' }],
      talk_to_npc: [{ npcItemType: FENNEC_ITEM_TYPE, count: 1 }],
    },
    rewards: { gems: 140, xp: 40 },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'I have a soft spot for Goldfish. Cast until one flashes gold in your bag — it may take many tries.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'No Goldfish yet? Keep casting. Luck likes stubborn paws.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'There — a little sunbeam with fins. Beautiful catch.' },
    ],
  },
  {
    questId: 'fennec_koi_patience',
    type: 'story',
    title: 'Painted Scales',
    description: 'Catch a Koi. This one rewards long afternoons by the water.',
    farmLevelMin: 2,
    requiredQuestId: 'fennec_goldfish_wish',
    sortOrder: 240,
    triggers: [{ type: 'quest_complete', questId: 'fennec_goldfish_wish' }],
    requirements: {
      actions: [{ action: 'catch', itemType: 'koi', count: 1 }],
      equips: [{ slot: 'handTool', itemType: 'stick_fishing_pole' }],
      talk_to_npc: [{ npcItemType: FENNEC_ITEM_TYPE, count: 1 }],
    },
    rewards: { gems: 200, xp: 50 },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Koi are slower to trust. Fish when you have time to waste on purpose. Bring me one painted catch.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      { text: 'Still waiting on a Koi? Take a picnic. Cast. Wait. Come back when the bag shows colour.' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Look at those markings. Worth every quiet hour.' },
    ],
  },
  {
    questId: 'fennec_bass_bounty',
    type: 'story',
    title: 'Two Black Bass',
    description: 'Catch two Black Bass — a proper side hunt for a stronger pull.',
    farmLevelMin: 2,
    requiredQuestId: 'fennec_koi_patience',
    sortOrder: 245,
    triggers: [{ type: 'quest_complete', questId: 'fennec_koi_patience' }],
    requirements: {
      actions: [{ action: 'catch', itemType: 'black_bass', count: 2 }],
      equips: [{ slot: 'handTool', itemType: 'stick_fishing_pole' }],
      talk_to_npc: [{ npcItemType: FENNEC_ITEM_TYPE, count: 1 }],
    },
    rewards: { gems: 220, xp: 55, items: [{ itemType: 'stick', qty: 12 }] },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Black Bass fight. Catch two when you feel stubborn — no deadline from me.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      { text: 'Two Black Bass still on the wishlist? Keep the Stick Pole equipped and enjoy the tug.' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Two bass! Your arms will remember that. Stick stash for more poles later.' },
    ],
  },
  {
    questId: 'fennec_pan_fry',
    type: 'story',
    title: 'Pan by the Water',
    description: 'Catch a Trout and cook it into Cooked Trout for Fennec.',
    farmLevelMin: 2,
    requiredQuestId: 'fennec_first_fish',
    sortOrder: 250,
    triggers: [{ type: 'quest_complete', questId: 'fennec_sell_catch' }],
    requirements: {
      actions: [
        { action: 'catch', itemType: 'trout', count: 1 },
        { action: 'cook', itemType: 'cooked_trout', count: 1 },
      ],
      items: [{ itemType: 'cooked_trout', qty: 1 }],
      talk_to_npc: [{ npcItemType: FENNEC_ITEM_TYPE, count: 1 }],
    },
    rewards: { gems: 160, xp: 45 },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Learn the Cooked Trout scroll, catch a Trout, then cook it on your farm pot. Bring the plate to town.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'Learn the scroll, then Trout → Cooked Trout in the bag. Tap me when supper is ready.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Smells like the river met a skillet. You fish like a chef now.' },
    ],
  },

  // ── Mrs. Teagan cooking track (NPC not auto-placed) ───────────────────────
  {
    questId: 'teagan_meet',
    type: 'story',
    title: 'The Cow in the Kitchen',
    description: 'Say hello to Mrs. Teagan and accept her first cooking scrolls.',
    farmLevelMin: 2,
    requiredQuestId: 'bramble_kitchen',
    sortOrder: 260,
    triggers: [{ type: 'talk_to_npc', npcItemType: TEAGAN_ITEM_TYPE }],
    requirements: { talk_to_npc: [{ npcItemType: TEAGAN_ITEM_TYPE, count: 1 }] },
    rewards: {
      gems: 50,
      xp: 20,
      items: [
        { itemType: 'recipe_tomato_soup', qty: 1 },
        { itemType: 'recipe_garden_salad', qty: 1 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Well butter my biscuits — a farmer with flour on their paws. I am Mrs. Teagan.',
      },
      {
        text: 'Bramble taught you bread. I teach the rest of the kitchen. Tap me again when you want scrolls.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      { text: 'Still shy of the stove? Tap me once more and I will send you home with recipes.' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'Tomato Soup and Garden Salad scrolls — learn them from your backpack before you cook.',
      },
    ],
  },
  {
    questId: 'teagan_soup_lesson',
    type: 'story',
    title: 'First Bubbles',
    description: 'Learn Tomato Soup and cook a pot for Mrs. Teagan.',
    farmLevelMin: 2,
    requiredQuestId: 'teagan_meet',
    sortOrder: 261,
    triggers: [{ type: 'quest_complete', questId: 'teagan_meet' }],
    requirements: {
      actions: [{ action: 'cook', itemType: 'tomato_soup', count: 1 }],
      talk_to_npc: [{ npcItemType: TEAGAN_ITEM_TYPE, count: 1 }],
    },
    rewards: {
      gems: 80,
      xp: 25,
      items: [
        { itemType: 'recipe_vegetable_soup', qty: 1 },
        { itemType: 'recipe_potato_soup', qty: 1 },
        { itemType: 'tomato', qty: 3 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Learn the Tomato Soup scroll, then cook it — tomatoes and water. Bring me the news when the pot settles.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'No soup yet? Learn the scroll, cook Tomato Soup, then tap me.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'There — that steam smells like a proper start. Vegetable and Potato Soup scrolls for later.',
      },
    ],
  },
  {
    questId: 'teagan_salad_bar',
    type: 'story',
    title: 'Something Crisp',
    description: 'Learn Garden Salad and cook one plate.',
    farmLevelMin: 2,
    requiredQuestId: 'teagan_soup_lesson',
    sortOrder: 262,
    triggers: [{ type: 'quest_complete', questId: 'teagan_soup_lesson' }],
    requirements: {
      actions: [{ action: 'cook', itemType: 'garden_salad', count: 1 }],
      talk_to_npc: [{ npcItemType: TEAGAN_ITEM_TYPE, count: 1 }],
    },
    rewards: {
      gems: 80,
      xp: 25,
      items: [
        { itemType: 'recipe_farmer_salad', qty: 1 },
        { itemType: 'recipe_summer_salad', qty: 1 },
        { itemType: 'recipe_garden_sandwich', qty: 1 },
        { itemType: 'lettuce', qty: 3 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Soup fills the belly; salad wakes it up. Learn Garden Salad — lettuce and tomato — and cook one.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'Still need that Garden Salad? Learn, cook, then find me.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'Crunch! Farmer and Summer Salad scrolls, plus Garden Sandwich for next — picnic food for patient growers.',
      },
    ],
  },
  {
    questId: 'teagan_lunch_counter',
    type: 'story',
    title: 'Bread Meets Garden',
    description: 'Learn Garden Sandwich and cook one for Mrs. Teagan.',
    farmLevelMin: 2,
    requiredQuestId: 'teagan_salad_bar',
    sortOrder: 263,
    triggers: [{ type: 'quest_complete', questId: 'teagan_salad_bar' }],
    requirements: {
      actions: [{ action: 'cook', itemType: 'garden_sandwich', count: 1 }],
      talk_to_npc: [{ npcItemType: TEAGAN_ITEM_TYPE, count: 1 }],
    },
    rewards: {
      gems: 100,
      xp: 30,
      items: [
        { itemType: 'recipe_tomato_sandwich', qty: 1 },
        { itemType: 'recipe_cheese_sandwich', qty: 1 },
        { itemType: 'recipe_apple_bread', qty: 1 },
        { itemType: 'bread', qty: 2 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Sandwiches are honesty between two slices. Learn the Garden Sandwich scroll — bread and lettuce — then cook it.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'One Garden Sandwich still. Learn the scroll if you have not, then cook.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'Lunch-counter approved. More sandwich scrolls, spare bread, and an Apple Bread scroll for bakery shift.',
      },
    ],
  },
  {
    questId: 'teagan_bakery_shift',
    type: 'story',
    title: 'Sweet Loaves',
    description: 'Learn Apple Bread and bake a loaf for Mrs. Teagan.',
    farmLevelMin: 2,
    requiredQuestId: 'teagan_lunch_counter',
    sortOrder: 264,
    triggers: [{ type: 'quest_complete', questId: 'teagan_lunch_counter' }],
    requirements: {
      actions: [{ action: 'cook', itemType: 'apple_bread', count: 1 }],
      talk_to_npc: [{ npcItemType: TEAGAN_ITEM_TYPE, count: 1 }],
    },
    rewards: {
      gems: 120,
      xp: 35,
      items: [
        { itemType: 'recipe_honey_bread', qty: 1 },
        { itemType: 'recipe_pumpkin_bread', qty: 1 },
        { itemType: 'recipe_apple_crumble', qty: 1 },
        { itemType: 'apple', qty: 2 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Bakery shift! Learn Apple Bread — a loaf and an apple — then bake one while the kitchen smells like autumn.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'Waiting on Apple Bread. Scroll, pot, tap me when it is done.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'Warm and golden. Honey and Pumpkin Bread scrolls — and Apple Crumble for the dessert case.',
      },
    ],
  },
  {
    questId: 'teagan_dessert_case',
    type: 'story',
    title: 'The Dessert Case',
    description: 'Learn Apple Crumble and bake one sweet for Mrs. Teagan.',
    farmLevelMin: 2,
    requiredQuestId: 'teagan_bakery_shift',
    sortOrder: 265,
    triggers: [{ type: 'quest_complete', questId: 'teagan_bakery_shift' }],
    requirements: {
      actions: [{ action: 'cook', itemType: 'apple_crumble', count: 1 }],
      talk_to_npc: [{ npcItemType: TEAGAN_ITEM_TYPE, count: 1 }],
    },
    rewards: {
      gems: 140,
      xp: 40,
      items: [
        { itemType: 'recipe_jam_cookies', qty: 1 },
        { itemType: 'recipe_honey_cookies', qty: 1 },
        { itemType: 'recipe_herbal_tea', qty: 1 },
        { itemType: 'recipe_fruit_punch', qty: 1 },
        { itemType: 'sugar', qty: 2 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Dessert case opens with Apple Crumble — apples, flour, sugar. Learn the scroll and bake.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'No crumble yet? Learn, cook, then come back smelling like sugar.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'That will spoil dinner in the best way. Cookie scrolls, spare sugar, and tea-service drinks next.',
      },
    ],
  },
  {
    questId: 'teagan_tea_service',
    type: 'story',
    title: 'Tea Service',
    description: 'Learn Herbal Tea and Fruit Punch, cook both, then return to Mrs. Teagan.',
    farmLevelMin: 2,
    requiredQuestId: 'teagan_dessert_case',
    sortOrder: 266,
    triggers: [{ type: 'quest_complete', questId: 'teagan_dessert_case' }],
    requirements: {
      actions: [
        { action: 'cook', itemType: 'herbal_tea', count: 1 },
        { action: 'cook', itemType: 'fruit_punch', count: 1 },
      ],
      talk_to_npc: [{ npcItemType: TEAGAN_ITEM_TYPE, count: 1 }],
    },
    rewards: {
      gems: 200,
      xp: 50,
      items: [
        { itemType: 'recipe_mint_tea', qty: 1 },
        { itemType: 'recipe_berry_smoothie', qty: 1 },
        { itemType: 'milk', qty: 3 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'A chef finishes with drinks. Learn Herbal Tea and Fruit Punch, cook both, then we toast.',
      },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [
      {
        text: 'Still need Herbal Tea and Fruit Punch cooked. The kettle waits.',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      {
        text: 'Cheers, kitchen partner. Mint Tea and Berry Smoothie for rainy days — and milk for whatever you invent next. My door is always warm.',
      },
    ],
  },

  // ── Farm upgrades (parallel track) ────────────────────────────────────────
  {
    questId: 'farm_upgrade_2',
    type: 'farm_upgrade',
    title: 'Room to Grow',
    description: 'Prove you can work this patch and the fence line moves out.',
    farmLevel: 2,
    sortOrder: 150,
    requirements: {
      farmXp: 50,
      buildings: [{ itemType: 'soil', count: 2 }],
      actions: [{ action: 'harvest', itemType: 'wheat', count: 5 }],
    },
    rewards: { gems: 120, items: [{ itemType: 'tree_sappling_oak_apple', qty: 1 }] },
    endDialogSpeaker: 'pet',
    endDialog: [{ text: 'They moved the fence! Look how much room we have now!' }],
  },
  {
    questId: 'farm_upgrade_3',
    type: 'farm_upgrade',
    title: 'Break the Fence Line',
    description: 'A full larder buys a bigger farm.',
    farmLevel: 3,
    sortOrder: 160,
    requirements: {
      farmXp: 150,
      items: [{ itemType: 'wheat', qty: 10 }, { itemType: 'carrot', qty: 5 }],
    },
    rewards: { gems: 200, items: [{ itemType: 'pumpkin_seed', qty: 5 }] },
    endDialogSpeaker: 'pet',
    endDialog: [{ text: 'Budding — that is us! I like how that sounds.' }],
  },
  {
    questId: 'farm_upgrade_4',
    type: 'farm_upgrade',
    title: 'A Proper Homestead',
    description: 'Stock the pantry and claim the last of the meadow.',
    farmLevel: 4,
    sortOrder: 170,
    requirements: {
      farmXp: 350,
      items: [{ itemType: 'pumpkin', qty: 3 }, { itemType: 'bread', qty: 1 }],
    },
    rewards: { gems: 300, items: [{ itemType: 'watermelon_seeds', qty: 2 }] },
    endDialogSpeaker: 'pet',
    endDialog: [{ text: 'All the way to the treeline. This really feels like home.' }],
  },
];

// ─── Upserts ────────────────────────────────────────────────────────────────

async function upsertNpcItem(def: Record<string, unknown> & { itemType: string }): Promise<{ hasArt: boolean }> {
  try {
    const created = await admin<{ imageUrl?: string }>('POST', '/admin/game-items', def);
    console.log(`  created item ${def.itemType}`);
    return { hasArt: Boolean(created.imageUrl) };
  } catch (err) {
    if (!(err instanceof ApiFailure) || err.status !== 409) throw err;
    const { itemType, ...patch } = def;
    const updated = await admin<{ imageUrl?: string }>(
      'PATCH',
      `/admin/game-items/${itemType}`,
      patch,
    );
    console.log(`  updated item ${itemType}`);
    return { hasArt: Boolean(updated.imageUrl) };
  }
}

/** Swap the town fisherman prop for the talkable Fennec NPC (same spot). */
async function ensureFennecInTown(): Promise<void> {
  type Placement = { id: string; itemType: string; live?: boolean; x: number; y: number; scale?: number };
  const scene = await admin<{ placements: Placement[] }>('GET', `/admin/scenes/${TOWN_SCENE_SLUG}`);

  let changed = false;
  const placements = scene.placements.map((p) => {
    if (p.itemType !== 'fennec_fox_fisherman' && p.itemType !== FENNEC_ITEM_TYPE) return p;
    if (p.itemType === FENNEC_ITEM_TYPE && p.live) return p;
    changed = true;
    return { ...p, itemType: FENNEC_ITEM_TYPE, live: true };
  });

  if (!placements.some((p) => p.itemType === FENNEC_ITEM_TYPE)) {
    placements.push({
      id: `p_fennec_${Date.now()}`,
      itemType: FENNEC_ITEM_TYPE,
      x: 1876,
      y: 844,
      scale: 0.833,
      live: true,
    });
    changed = true;
  }

  if (!changed) {
    console.log('  town already has fennec_fox');
    return;
  }

  await admin('PATCH', `/admin/scenes/${TOWN_SCENE_SLUG}`, { placements });
  console.log('  town placement → fennec_fox (live)');
}

async function generateNpcArt(
  itemType: string,
  prompt: string,
): Promise<void> {
  console.log(`  generating art for ${itemType} (this takes a minute)…`);
  try {
    const result = await admin<{ imageUrl: string }>(
      'POST',
      `/admin/game-items/${itemType}/generate-image`,
      { prompt },
    );
    console.log(`  art: ${result.imageUrl}`);
  } catch (err) {
    console.error(`  ✗ art failed for ${itemType}: ${(err as Error).message}`);
  }
}

function reportWarnings(warnings?: { field: string; message: string }[]): void {
  for (const w of warnings ?? []) console.log(`      ! ${w.field}: ${w.message}`);
}

async function upsertQuest(quest: Quest): Promise<boolean> {
  const { questId, ...rest } = quest;
  try {
    const created = await admin<{ warnings?: { field: string; message: string }[] }>(
      'POST',
      '/admin/quests',
      quest,
    );
    console.log(`  + ${questId}`);
    reportWarnings(created.warnings);
    return true;
  } catch (err) {
    if (err instanceof ApiFailure && err.status === 409) {
      const updated = await admin<{ warnings?: { field: string; message: string }[] }>(
        'PATCH',
        `/admin/quests/${questId}`,
        rest,
      );
      console.log(`  ~ ${questId}`);
      reportWarnings(updated.warnings);
      return true;
    }
    console.error(`  ✗ ${questId}: ${(err as Error).message}`);
    return false;
  }
}

// ─── Run ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Seeding starter content against ${base} as ${userId}\n`);

  console.log('NPCs');
  const { hasArt } = await upsertNpcItem(npc);
  if (!hasArt && !flags.has('--no-art')) await generateNpcArt(NPC_ITEM_TYPE, NPC_ART_PROMPT);
  else if (!hasArt) console.log('  bramble: no art yet (--no-art)');
  else console.log('  bramble: art already present');

  const fennec = await upsertNpcItem(fennecNpc);
  console.log(fennec.hasArt ? '  fennec_fox: art present' : '  fennec_fox: no art');
  await ensureFennecInTown();

  const teagan = await upsertNpcItem(teaganNpc);
  if (!teagan.hasArt && !flags.has('--no-art')) {
    await generateNpcArt(TEAGAN_ITEM_TYPE, TEAGAN_ART_PROMPT);
  } else if (!teagan.hasArt) {
    console.log('  mrs_teagan: no art yet (--no-art)');
  } else {
    console.log('  mrs_teagan: art already present (not auto-placed)');
  }

  console.log('\nQuests');
  let ok = 0;
  for (const quest of quests) if (await upsertQuest(quest)) ok += 1;
  console.log(`  ${ok}/${quests.length} saved`);

  console.log('\nObsolete quests');
  for (const questId of OBSOLETE_QUEST_IDS) {
    try {
      await admin('DELETE', `/admin/quests/${questId}`);
      console.log(`  - ${questId}`);
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 404) {
        console.log(`  · ${questId} (already gone)`);
      } else {
        console.error(`  ✗ ${questId}: ${(err as Error).message}`);
      }
    }
  }

  if (!flags.has('--no-kit')) {
    console.log('\nTest kit');
    for (const { itemType, qty } of TEST_KIT) {
      try {
        await admin('POST', '/admin/my-farm/grant-item', { itemType, qty });
        console.log(`  ${qty}× ${itemType}`);
      } catch (err) {
        console.error(`  ✗ ${itemType}: ${(err as Error).message}`);
      }
    }
  }

  if (!flags.has('--no-place')) {
    console.log('\nPlacing Bramble');
    try {
      const at = await admin<{ col: number; row: number }>('POST', '/admin/my-farm/place-item', {
        itemType: NPC_ITEM_TYPE,
      });
      console.log(`  placed at col ${at.col}, row ${at.row}`);
    } catch (err) {
      console.error(`  ✗ ${(err as Error).message}`);
    }
  }

  if (flags.has('--replay')) {
    console.log('\nResetting quest progress');
    const reset = await admin<{ deleted: number; farmLevel: number }>(
      'POST',
      '/admin/my-farm/reset-quests',
      { keepFarmLevel: true },
    );
    console.log(`  cleared ${reset.deleted} rows, farm still level ${reset.farmLevel}`);
  }

  const lint = await admin<{ problems: { questId: string; field: string; message: string; severity: string }[] }>(
    'GET',
    '/admin/quests/lint',
  );
  const errors = lint.problems.filter((p) => p.severity === 'error');
  console.log(`\nLint: ${errors.length} errors, ${lint.problems.length - errors.length} warnings`);
  for (const p of errors) console.log(`  ✗ ${p.questId} ${p.field}: ${p.message}`);

  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\nseed failed:', err.message ?? err);
  process.exit(1);
});
