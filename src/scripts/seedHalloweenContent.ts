/**
 * Wick's Haunt Internship — pumpkin-headed hedgehog NPC, Candy Corn currency,
 * Halloween furniture recipe costs, Haunt Kettle (Spirit Snatch), and a 20-quest
 * linear story chain. Reuses existing haunted/ghost bugs and fish.
 *
 * Run: npm run seed:halloween -- <adminUserId> [--no-art] [--no-place]
 *
 * Re-running updates in place. Does not reset quest progress.
 */
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const userId = process.argv[2];
const flags = new Set(process.argv.slice(3));
if (!userId) {
  console.error('Usage: npm run seed:halloween -- <adminUserId> [--no-art] [--no-place]');
  process.exit(1);
}

const token = jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: '1h' });
const base = `http://localhost:${env.PORT}`;

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

const WICK = 'wick';
const KETTLE = 'wick_kettle';
const CANDY = 'candy_corn';

const wickNpc = {
  itemType: WICK,
  label: 'Wick',
  emoji: '🎃',
  color: '#e08a3a',
  category: 'npc' as const,
  placeable: true,
  cols: 3,
  rows: 3,
  sellable: false,
  buyable: false,
  npcDialog: [
    { text: 'Name’s Wick. Haunt intern. Your farm is legally too friendly. I’m writing you up. Also, do you have a snack.' },
    { text: 'The robe is regulation. The pumpkin is… a long story. Do not ask about Scare School.' },
    { text: 'Candy Corn is official haunt currency. Gems are for people who passed the exam.' },
  ],
};

const candyCorn = {
  itemType: CANDY,
  label: 'Candy Corn',
  emoji: '🍬',
  color: '#f4c56d',
  category: 'material' as const,
  placeable: false,
  cols: 1,
  rows: 1,
  sellable: false,
  buyable: false,
  isCurrency: true,
};

const wickKettle = {
  itemType: KETTLE,
  label: "Wick's Haunt Kettle",
  emoji: '🍲',
  color: '#6b3fa0',
  category: 'decoration' as const,
  placeable: true,
  cols: 2,
  rows: 2,
  sellable: false,
  buyable: false,
  interactAction: { type: 'open_modal' as const, payload: 'spirit_snatch' },
};

const WICK_ART =
  'A single tiny cute hedgehog character standing upright with a carved jack-o-lantern pumpkin for a head, ' +
  'wearing an oversized moth-eaten wizard robe with sleeves that drag on the ground, friendly and huggable, ' +
  '2D game sprite for a cozy top-down farming game. Soft warm autumn palette, rounded shapes, clean thick outlines, ' +
  'front-facing three-quarter view, centered, transparent background, no shadow, no text.';

const CANDY_ART =
  'A small pile of classic candy corn pieces, yellow white and orange triangles, 2D game item icon for a cozy ' +
  'farming game. Flat vector, thick outlines, centered, transparent background, no shadow, no text.';

const KETTLE_ART =
  'A small cute bubbling iron cauldron with a warm orange glow, tiny ghost wisps rising from it, 2D game sprite ' +
  'for a cozy top-down farming game. Rounded shapes, thick outlines, front-facing, centered, transparent background, no shadow, no text.';

type Ingredient = { itemType: string; qty: number };

const HALLOWEEN_RECIPES: { recipeId: string; candy: number; ingredients: Ingredient[] }[] = [
  { recipeId: 'haunted_chair', candy: 12, ingredients: [{ itemType: 'wooden_plank', qty: 6 }, { itemType: 'cloth', qty: 3 }, { itemType: 'iron', qty: 1 }] },
  { recipeId: 'haunted_table', candy: 15, ingredients: [{ itemType: 'wooden_plank', qty: 8 }, { itemType: 'iron', qty: 2 }] },
  { recipeId: 'coffin_bed', candy: 25, ingredients: [{ itemType: 'wooden_plank', qty: 12 }, { itemType: 'cloth', qty: 6 }, { itemType: 'iron', qty: 4 }] },
  { recipeId: 'witch_wardrobe', candy: 25, ingredients: [{ itemType: 'wooden_plank', qty: 12 }, { itemType: 'iron', qty: 4 }, { itemType: 'crystal', qty: 2 }] },
  { recipeId: 'ghost_lamp', candy: 10, ingredients: [{ itemType: 'glass', qty: 2 }, { itemType: 'cloth', qty: 2 }, { itemType: 'crystal', qty: 1 }] },
  { recipeId: 'skeleton_throne', candy: 40, ingredients: [{ itemType: 'iron', qty: 10 }, { itemType: 'stone', qty: 6 }, { itemType: 'crystal', qty: 2 }] },
  { recipeId: 'spiderweb_rug', candy: 5, ingredients: [{ itemType: 'cloth', qty: 6 }] },
  { recipeId: 'jack_o_lantern_lamp', candy: 10, ingredients: [{ itemType: 'wood', qty: 3 }, { itemType: 'glass', qty: 2 }, { itemType: 'iron', qty: 1 }] },
  { recipeId: 'haunted_bookcase', candy: 18, ingredients: [{ itemType: 'wooden_plank', qty: 10 }, { itemType: 'iron', qty: 2 }, { itemType: 'crystal', qty: 1 }] },
  { recipeId: 'witch_cauldron', candy: 30, ingredients: [{ itemType: 'iron', qty: 10 }, { itemType: 'stone', qty: 4 }, { itemType: 'crystal', qty: 2 }] },
  { recipeId: 'bone_shelf', candy: 8, ingredients: [{ itemType: 'stone', qty: 6 }, { itemType: 'iron', qty: 2 }] },
  { recipeId: 'haunted_mirror', candy: 20, ingredients: [{ itemType: 'glass', qty: 4 }, { itemType: 'iron', qty: 4 }, { itemType: 'crystal', qty: 2 }] },
];

type Quest = Record<string, unknown> & { questId: string };

const talk = { talk_to_npc: [{ npcItemType: WICK, count: 1 }] };

function after(prev: string, sortOrder: number, rest: Omit<Quest, 'requiredQuestId' | 'triggers' | 'sortOrder' | 'type' | 'farmLevelMin'> & { questId: string }): Quest {
  return {
    type: 'story',
    farmLevelMin: 1,
    requiredQuestId: prev,
    sortOrder,
    triggers: [{ type: 'quest_complete', questId: prev }],
    ...rest,
  };
}

const quests: Quest[] = [
  {
    questId: 'wick_orientation',
    type: 'story',
    title: 'Official Haunt Orientation',
    description: 'Say hello to Wick, the haunt intern with a pumpkin for a head.',
    farmLevelMin: 1,
    sortOrder: 900,
    triggers: [{ type: 'talk_to_npc', npcItemType: WICK }],
    requirements: { ...talk },
    rewards: {
      gems: 40,
      xp: 15,
      items: [
        { itemType: CANDY, qty: 12 },
        { itemType: 'jack_o_lantern_lamp', qty: 1 },
      ],
      recipes: ['jack_o_lantern_lamp'],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      { text: 'Name’s Wick. Haunt intern. Your farm is legally too friendly. I’m writing you up. Also, do you have a snack.', speaker: 'npc' },
      { text: 'Hi! We like friendly. Is the pumpkin… you?', speaker: 'pet' },
      { text: 'The pumpkin is regulation. The robe is also regulation. Being huggable is a write-up from Scare School. Do not mention Scare School.', speaker: 'npc' },
      { text: 'I am assigning you Candy Corn. It is official haunt currency. You will need it to craft spooky furniture. Gems are for people who passed the exam.', speaker: 'npc' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Take this lamp. Place it. Darkness is a code violation. Tap me when the porch is legal.', speaker: 'npc' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [{ text: 'Still in orientation? Tap me again. I have a clipboard. It is a leaf.' }],
  },

  after('wick_orientation', 901, {
    questId: 'wick_porch_light',
    title: 'Porch Light Protocol',
    description: 'Place the Jack-o’-Lantern Lamp Wick handed you.',
    requirements: {
      buildings: [{ itemType: 'jack_o_lantern_lamp', count: 1 }],
      ...talk,
    },
    rewards: { gems: 30, xp: 10, items: [{ itemType: CANDY, qty: 10 }] },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Open your backpack and put the lamp down. Anywhere. I will still inspect the angle.',
        highlight: { type: 'inventory_item', target: 'jack_o_lantern_lamp' },
        speaker: 'npc',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Acceptable glow. The fireflies next door filed a complaint that you are “gentle.” That’s worse. Catch three. Night shift.', speaker: 'npc' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [{ text: 'The lamp is still in your bag. That is not a porch. That is a pocket.' }],
  }),

  after('wick_porch_light', 902, {
    questId: 'wick_night_fireflies',
    title: 'Night-Shift Fireflies',
    description: 'Catch 3 fireflies at night, then report to Wick.',
    requirements: {
      actions: [{ action: 'catch', itemType: 'firefly', count: 3 }],
      ...talk,
    },
    rewards: {
      gems: 40,
      xp: 15,
      items: [{ itemType: CANDY, qty: 12 }],
      recipes: ['spiderweb_rug'],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      { text: 'Net out. Forest. Night. Three fireflies. They keep smiling. Confiscate the smiles.', speaker: 'npc' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Inventory updated. Rug recipe attached — you will need Candy Corn to weave it later. First, the pond. Something is being too fish.', speaker: 'npc' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [{ text: 'Three fireflies. Night. I can wait. The clipboard cannot.' }],
  }),

  after('wick_night_fireflies', 903, {
    questId: 'wick_pond_lurker',
    title: 'Something in the Pond',
    description: 'Catch 1 catfish at night, then return to Wick.',
    requirements: {
      actions: [{ action: 'catch', itemType: 'catfish', count: 1 }],
      ...talk,
    },
    rewards: {
      gems: 40,
      xp: 15,
      items: [
        { itemType: CANDY, qty: 12 },
        { itemType: 'pumpkin_seed', qty: 3 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      { text: 'River or pond. Night. One catfish. It has whiskers. Whiskers are unofficially spooky. Bring it.', speaker: 'npc' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Whiskers confiscated. Plant these pumpkin seeds immediately. Haunt logistics require gourds and they take twelve minutes. I timed it.', speaker: 'npc' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [{ text: 'Still no catfish? Cast at night. Panic and they swim circles around you. I read that on a fox.' }],
  }),

  after('wick_pond_lurker', 904, {
    questId: 'wick_gourd_supply',
    title: 'Emergency Gourd Supply',
    description: 'Harvest 2 pumpkins, then talk to Wick.',
    requirements: {
      actions: [{ action: 'harvest', itemType: 'pumpkin', count: 2 }],
      ...talk,
    },
    rewards: {
      gems: 50,
      xp: 15,
      items: [
        { itemType: CANDY, qty: 15 },
        { itemType: 'recipe_pumpkin_soup', qty: 1 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      { text: 'Two pumpkins. Soil, water, wait. I will stand here being legally ominous.', speaker: 'npc' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Gourd quota met. Learn the soup scroll. Cook one bowl. I drink through the mouth hole. It leaks. That is a you problem.', speaker: 'npc' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [{ text: 'Still growing? Twelve minutes is not a suggestion. It is a grow time.' }],
  }),

  after('wick_gourd_supply', 905, {
    questId: 'wick_soup',
    title: 'Soup for the Scare',
    description: 'Cook 1 pumpkin soup, then bring Wick the news (the soup is consumed on turn-in).',
    requirements: {
      actions: [{ action: 'cook', itemType: 'pumpkin_soup', count: 1 }],
      items: [{ itemType: 'pumpkin_soup', qty: 1 }],
      ...talk,
    },
    rewards: { gems: 40, xp: 15, items: [{ itemType: CANDY, qty: 10 }] },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Learn the scroll if you have not. Then cook. Pumpkin soup. One bowl. I will inspect the steam.',
        highlight: { type: 'cook_item', target: 'pumpkin_soup' },
        speaker: 'npc',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Steam: adequate. Flavor: friendly. Citation pending. Next: bones. Dig two fossils. The shelf must rattle authentically.', speaker: 'npc' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [{ text: 'No soup, no rattle. Kitchen. Pot. Pumpkin. You know this.' }],
  }),

  after('wick_soup', 906, {
    questId: 'wick_borrowed_bones',
    title: 'Borrowed Bones',
    description: 'Dig up 2 fossils, then report to Wick.',
    requirements: {
      actions: [{ action: 'dig_fossil', count: 2 }],
      ...talk,
    },
    rewards: {
      gems: 45,
      xp: 15,
      items: [{ itemType: CANDY, qty: 12 }],
      recipes: ['bone_shelf'],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      { text: 'Shovel. Holes. Two fossils. I need authentic rattle for the bone shelf. Please do not name them.', speaker: 'npc' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Rattle acquired. Bone Shelf recipe filed. Now: a Ghost Spirit Clump. Rare. Night. It looks like a hug. Catch it anyway.', speaker: 'npc' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [{ text: 'Two fossils. The holes are not going to dig themselves. I checked.' }],
  }),

  after('wick_borrowed_bones', 907, {
    questId: 'wick_ghost_clump',
    title: 'Moth Inventory, Spirit Edition',
    description: 'Catch 1 Ghost Spirit Clump at night, then talk to Wick.',
    requirements: {
      actions: [{ action: 'catch', itemType: 'ghost_spirit_clump', count: 1 }],
      ...talk,
    },
    rewards: {
      gems: 55,
      xp: 20,
      items: [{ itemType: CANDY, qty: 15 }],
      recipes: ['ghost_lamp'],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      { text: 'Ghost Spirit Clump. Night. It will try to be cute. That is how they get you. Net anyway.', speaker: 'npc' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Clump contained. Ghost Lamp recipe is yours. Next, an eel. River. Night. Long, rude, on-brand.', speaker: 'npc' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [{ text: 'No clump yet? Night. Net. Resist the urge to name it Squish.' }],
  }),

  after('wick_ghost_clump', 908, {
    questId: 'wick_river_eel',
    title: 'River After Dark',
    description: 'Catch 1 eel at night, then return to Wick.',
    requirements: {
      actions: [{ action: 'catch', itemType: 'eel', count: 1 }],
      ...talk,
    },
    rewards: { gems: 50, xp: 15, items: [{ itemType: CANDY, qty: 15 }] },
    startDialogSpeaker: 'npc',
    startDialog: [
      { text: 'One eel. Night river. If it looks at you like a noodle with opinions, that is the one.', speaker: 'npc' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Noodle acquired. Intern exam time. Tap my kettle — Spirit Snatch. Treats good. Trick bags bad. Score eight treats in one sitting, or several. I am flexible. The kettle is not.', speaker: 'npc' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [{ text: 'Eel. Night. River. I believe in you in a legally ominous way.' }],
  }),

  after('wick_river_eel', 909, {
    questId: 'wick_spirit_snatch',
    title: 'Spirit Snatch, Intern Edition',
    description: 'Play Spirit Snatch at Wick’s kettle and snatch 8 treats, then talk to Wick.',
    requirements: {
      actions: [{ action: 'spirit_snatch', count: 8 }],
      ...talk,
    },
    rewards: {
      gems: 60,
      xp: 20,
      items: [
        { itemType: CANDY, qty: 20 },
        { itemType: 'cloth', qty: 6 },
      ],
      recipes: ['haunted_chair'],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Tap the kettle beside me. Friendly spirits are treats. Trick bags are citations. Eight treats. Go.',
        highlight: { type: 'world_item', target: KETTLE },
        speaker: 'npc',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'You snatched. Chair recipe granted. Also cloth, because later you will weave a rug and I refuse to hear “I have no cloth.” Next: a Spooky Cricket. Epic. Night. It already knows the joke.', speaker: 'npc' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [{ text: 'Kettle. Eight treats. Trick bags do not count. They subtract. I designed that.' }],
  }),

  after('wick_spirit_snatch', 910, {
    questId: 'wick_spooky_cricket',
    title: 'Web Quality Control, Cricket Edition',
    description: 'Catch 1 Spooky Cricket at night, then talk to Wick.',
    requirements: {
      actions: [{ action: 'catch', itemType: 'spooky_cricket', count: 1 }],
      ...talk,
    },
    rewards: { gems: 55, xp: 20, items: [{ itemType: CANDY, qty: 15 }] },
    startDialogSpeaker: 'npc',
    startDialog: [
      { text: 'Spooky Cricket. Night. It chirps in a minor key. Catch one. Do not dance.', speaker: 'npc' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Chirp confiscated. Craft the Spiderweb Rug. Candy Corn plus the cloth I already gave you. This is your first official haunt craft. I will grade the corners.', speaker: 'npc' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [{ text: 'One Spooky Cricket. Night. If you hear a joke, that is it. Net the joke.' }],
  }),

  after('wick_spooky_cricket', 911, {
    questId: 'wick_first_craft',
    title: 'First Official Craft',
    description: 'Craft a Spiderweb Rug, then show Wick.',
    requirements: {
      actions: [{ action: 'craft', itemType: 'spiderweb_rug', count: 1 }],
      ...talk,
    },
    rewards: {
      gems: 50,
      xp: 15,
      items: [
        { itemType: CANDY, qty: 10 },
        { itemType: 'pumpkin_soup', qty: 1 },
      ],
      recipes: ['haunted_table'],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Crafting table. Spiderweb Rug. Spend the Candy Corn. That is the point of Candy Corn.',
        highlight: { type: 'craft_item', target: 'spiderweb_rug' },
        speaker: 'npc',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Corners: passable. Table recipe filed. Union rules: feed your pet that soup. Morale form. I have a leaf for that too.', speaker: 'npc' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [{ text: 'Rug. Craft it. Candy Corn is not for snacking. I mean it is, but not this Candy Corn.' }],
  }),

  after('wick_first_craft', 912, {
    questId: 'wick_union_treats',
    title: 'Union-Mandated Treats',
    description: 'Feed your pet pumpkin soup, then talk to Wick.',
    requirements: {
      actions: [{ action: 'feed_pet', itemType: 'pumpkin_soup', count: 1 }],
      ...talk,
    },
    rewards: { gems: 40, xp: 10, items: [{ itemType: CANDY, qty: 10 }] },
    startDialogSpeaker: 'npc',
    startDialog: [
      { text: 'Place the soup or dish it. Let your friend eat. Haunt internships include mandatory snacks. I did not write the rule. I laminated it.', speaker: 'npc' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Morale: up. Citation: withdrawn. Shake three trees and pick up five sticks. Kindling for a totally legal cauldron stand.', speaker: 'npc' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [{ text: 'The soup is for the pet. Not for the pumpkin head. I already leaked once today.' }],
  }),

  after('wick_union_treats', 913, {
    questId: 'wick_kindling',
    title: 'Kindling Inspection',
    description: 'Shake 3 trees and pick up 5 sticks, then talk to Wick.',
    requirements: {
      actions: [
        { action: 'shake_tree', count: 3 },
        { action: 'pickup_ground', itemType: 'stick', count: 5 },
      ],
      ...talk,
    },
    rewards: {
      gems: 45,
      xp: 15,
      items: [{ itemType: CANDY, qty: 12 }],
      recipes: ['haunted_bookcase'],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      { text: 'Shake three trees. Pick up five sticks. If fruit falls, that is a bonus haunt. I will allow it.', speaker: 'npc' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Kindling: legal-ish. Bookcase recipe yours. Now the hard ones. Pumpkin Ladybug. Afternoon. Unique. Orange. Catch it before it files a cute complaint.', speaker: 'npc' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [{ text: 'Three shakes. Five sticks. The trees are in on this. They just need a nudge.' }],
  }),

  after('wick_kindling', 914, {
    questId: 'wick_pumpkin_ladybug',
    title: 'Luna, Please — Pumpkin Edition',
    description: 'Catch 1 Pumpkin Ladybug (afternoon), then talk to Wick.',
    requirements: {
      actions: [{ action: 'catch', itemType: 'pumpkin_ladybug', count: 1 }],
      ...talk,
    },
    rewards: {
      gems: 80,
      xp: 25,
      items: [{ itemType: CANDY, qty: 25 }],
      recipes: ['witch_wardrobe'],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      { text: 'Pumpkin Ladybug. Afternoon. Unique. It is me, but smaller, and it can fly. I am not jealous. Catch it.', speaker: 'npc' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Tiny me acquired. Wardrobe recipe filed. Next: Ghost Koi. Pond. Night. Unique. It is a fish that is also a rumor.', speaker: 'npc' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [{ text: 'Afternoon. Ladybug. Pumpkin-colored. If you see a regular ladybug, that is a decoy. Probably.' }],
  }),

  after('wick_pumpkin_ladybug', 915, {
    questId: 'wick_ghost_koi',
    title: 'Shadow in the Current',
    description: 'Catch 1 Ghost Koi at the pond at night, then talk to Wick.',
    requirements: {
      actions: [{ action: 'catch', itemType: 'ghost_koi', count: 1 }],
      ...talk,
    },
    rewards: {
      gems: 80,
      xp: 25,
      items: [{ itemType: CANDY, qty: 25 }],
      recipes: ['coffin_bed'],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      { text: 'Ghost Koi. Pond. Night. Unique. If it looks see-through, that is the point. Reel anyway.', speaker: 'npc' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Rumor caught. Coffin Bed recipe — it is a bed. People sleep. I do not make the furniture names. Kettle again. Fifteen treats this time. Certification.', speaker: 'npc' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [{ text: 'Pond. Night. Ghost Koi. Cast like you mean it, intern.' }],
  }),

  after('wick_ghost_koi', 916, {
    questId: 'wick_snatch_cert',
    title: 'Snatch Certification',
    description: 'Score 15 treats in Spirit Snatch, then talk to Wick.',
    requirements: {
      actions: [{ action: 'spirit_snatch', count: 15 }],
      ...talk,
    },
    rewards: {
      gems: 70,
      xp: 20,
      items: [
        { itemType: CANDY, qty: 30 },
        { itemType: 'haunted_chair', qty: 1 },
      ],
      recipes: ['haunted_mirror'],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Kettle. Fifteen treats. One round or several. Trick bags still subtract. I am consistent.',
        highlight: { type: 'world_item', target: KETTLE },
        speaker: 'npc',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Certified snatcher. Mirror recipe plus a chair I already assembled because I do not trust your corners yet. Place the lamp, the rug, and this chair. Three-piece haunt. Inspection.', speaker: 'npc' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [{ text: 'Fifteen treats. The kettle remembers your last score. I do not. Play again.' }],
  }),

  after('wick_snatch_cert', 917, {
    questId: 'wick_three_piece',
    title: 'Three-Piece Haunt',
    description: 'Have a Jack-o’-Lantern Lamp, Spiderweb Rug, and Haunted Chair placed on the farm.',
    requirements: {
      buildings: [
        { itemType: 'jack_o_lantern_lamp', count: 1 },
        { itemType: 'spiderweb_rug', count: 1 },
        { itemType: 'haunted_chair', count: 1 },
      ],
      ...talk,
    },
    rewards: {
      gems: 60,
      xp: 20,
      items: [
        { itemType: CANDY, qty: 20 },
        { itemType: 'iron', qty: 10 },
        { itemType: 'stone', qty: 4 },
        { itemType: 'crystal', qty: 2 },
      ],
      recipes: ['witch_cauldron'],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      { text: 'Lamp. Rug. Chair. All down on the farm. If you stored them, un-store them. Haunt is a display sport.', speaker: 'npc' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Display: pass. Cauldron recipe plus the iron, stone, and crystal so you can actually craft it later. Guest stars next: Haunted Firefly and Phantom Moth. Night. Unique. Both of them. I believe in overtime.', speaker: 'npc' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [{ text: 'Three pieces. Lamp, rug, chair. If one is in storage I will know. The clipboard knows.' }],
  }),

  after('wick_three_piece', 918, {
    questId: 'wick_guest_stars',
    title: 'Guest Stars',
    description: 'Catch 1 Haunted Firefly and 1 Phantom Moth at night, then talk to Wick.',
    requirements: {
      actions: [
        { action: 'catch', itemType: 'haunted_firefly', count: 1 },
        { action: 'catch', itemType: 'phantom_moth', count: 1 },
      ],
      ...talk,
    },
    rewards: {
      gems: 100,
      xp: 30,
      items: [{ itemType: CANDY, qty: 35 }],
      recipes: ['skeleton_throne'],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      { text: 'Haunted Firefly and Phantom Moth. Night. Unique. They are on the guest list. Catch the guest list.', speaker: 'npc' },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Guests contained. Throne recipe — do not sit on it until you are Junior Haunt. Final inspection: craft the Witch Cauldron, snatch twenty treats, then talk to me. Promotion paperwork. It is also a leaf.', speaker: 'npc' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [{ text: 'Two uniques. Night. Firefly and moth. I will wait. The leaf will wait louder.' }],
  }),

  after('wick_guest_stars', 919, {
    questId: 'wick_final_inspection',
    title: 'Final Inspection',
    description: 'Craft a Witch Cauldron, snatch 20 treats at the kettle, then talk to Wick.',
    requirements: {
      actions: [
        { action: 'craft', itemType: 'witch_cauldron', count: 1 },
        { action: 'spirit_snatch', count: 20 },
      ],
      ...talk,
    },
    rewards: {
      gems: 150,
      xp: 40,
      items: [
        { itemType: CANDY, qty: 40 },
        { itemType: 'ghost_plush', qty: 1 },
      ],
    },
    startDialogSpeaker: 'npc',
    startDialog: [
      {
        text: 'Craft the cauldron with the mats I gave you. Then kettle — twenty treats. Then tap me. Do it in that order or a different order. I cannot see the future. The pumpkin has no eyes. Wait.',
        highlight: { type: 'craft_item', target: 'witch_cauldron' },
        speaker: 'npc',
      },
    ],
    endDialogSpeaker: 'npc',
    endDialog: [
      { text: 'Congratulations. You are now Junior Haunt. Benefits include this robe pocket lint, forty Candy Corn, and a Ghost Plush that is definitely not me in a different hat.', speaker: 'npc' },
      { text: 'Please scare responsibly. If anyone asks, I passed Scare School. If they ask twice, change the subject to soup.', speaker: 'npc' },
      { text: 'We did it! Wick, you can visit anytime. We have snacks. Legal ones.', speaker: 'pet' },
    ],
    progressDialogSpeaker: 'npc',
    progressDialog: [{ text: 'Cauldron. Twenty treats. Then me. Promotion is not automatic. I have to say the words. I practiced.' }],
  }),
];

async function upsertItem(def: Record<string, unknown> & { itemType: string }): Promise<{ hasArt: boolean }> {
  try {
    const created = await admin<{ imageUrl?: string }>('POST', '/admin/game-items', def);
    console.log(`  created item ${def.itemType}`);
    return { hasArt: Boolean(created.imageUrl) };
  } catch (err) {
    if (!(err instanceof ApiFailure) || err.status !== 409) throw err;
    const { itemType, ...patch } = def;
    const updated = await admin<{ imageUrl?: string }>('PATCH', `/admin/game-items/${itemType}`, patch);
    console.log(`  updated item ${itemType}`);
    return { hasArt: Boolean(updated.imageUrl) };
  }
}

async function generateArt(itemType: string, prompt: string): Promise<void> {
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
    const created = await admin<{ warnings?: { field: string; message: string }[] }>('POST', '/admin/quests', quest);
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

async function patchHalloweenRecipes(): Promise<void> {
  for (const row of HALLOWEEN_RECIPES) {
    const ingredients = [...row.ingredients, { itemType: CANDY, qty: row.candy }];
    try {
      await admin('PATCH', `/admin/recipes/${row.recipeId}`, { ingredients });
      console.log(`  ~ ${row.recipeId} + ${row.candy} candy_corn`);
    } catch (err) {
      console.error(`  ✗ ${row.recipeId}: ${(err as Error).message}`);
    }
  }
}

async function main() {
  console.log(`Seeding Halloween content against ${base} as ${userId}\n`);

  console.log('Items');
  const candy = await upsertItem(candyCorn);
  if (!candy.hasArt && !flags.has('--no-art')) await generateArt(CANDY, CANDY_ART);
  else console.log(candy.hasArt ? '  candy_corn: art present' : '  candy_corn: no art (--no-art)');

  const wick = await upsertItem(wickNpc);
  if (!wick.hasArt && !flags.has('--no-art')) await generateArt(WICK, WICK_ART);
  else console.log(wick.hasArt ? '  wick: art present' : '  wick: no art (--no-art)');

  const kettle = await upsertItem(wickKettle);
  if (!kettle.hasArt && !flags.has('--no-art')) await generateArt(KETTLE, KETTLE_ART);
  else console.log(kettle.hasArt ? '  wick_kettle: art present' : '  wick_kettle: no art (--no-art)');

  console.log('\nHalloween recipes (Candy Corn costs)');
  await patchHalloweenRecipes();

  console.log('\nQuests');
  let ok = 0;
  for (const quest of quests) if (await upsertQuest(quest)) ok += 1;
  console.log(`  ${ok}/${quests.length} saved`);

  if (!flags.has('--no-place')) {
    console.log('\nPlacing Wick + kettle');
    for (const itemType of [WICK, KETTLE]) {
      try {
        const at = await admin<{ col: number; row: number }>('POST', '/admin/my-farm/place-item', { itemType });
        console.log(`  ${itemType} at col ${at.col}, row ${at.row}`);
      } catch (err) {
        console.error(`  ✗ ${itemType}: ${(err as Error).message}`);
      }
    }
  }

  const lint = await admin<{ problems: { questId: string; field: string; message: string; severity: string }[] }>(
    'GET',
    '/admin/quests/lint',
  );
  const halloweenProblems = lint.problems.filter((p) => p.questId.startsWith('wick_'));
  const errors = halloweenProblems.filter((p) => p.severity === 'error');
  console.log(`\nLint (Wick): ${errors.length} errors, ${halloweenProblems.length - errors.length} warnings`);
  for (const p of errors) console.log(`  ✗ ${p.questId} ${p.field}: ${p.message}`);

  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\nseed failed:', err.message ?? err);
  process.exit(1);
});
