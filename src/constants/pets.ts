// ─── Pet Type Definitions ───────────────────────────────────────────────────

export interface PetDefinition {
  name: string;
  vibe: string;
  category: PetCategory;
  special: boolean;
}

export type PetCategory = 'cute' | 'cool' | 'fierce' | 'mythic' | 'buggy' | 'aquatic' | 'cosmic';

export interface ColorCombo {
  base: string;
  secondary: string;
}

export interface GeneratedPet {
  name: string;
  vibe: string;
  category: PetCategory;
  special: boolean;
  baseColor: string;
  secondaryColor: string;
}

// ─── Cute Pets ──────────────────────────────────────────────────────────────

export const CUTE_PETS: PetDefinition[] = [
  { name: 'Calico Cat', vibe: 'Cozy', category: 'cute', special: false },
  { name: 'Bunny', vibe: 'Bouncy', category: 'cute', special: false },
  { name: 'Puppy', vibe: 'Friendly', category: 'cute', special: true },
  { name: 'Axolotl', vibe: 'Adorable', category: 'cute', special: false },
  { name: 'Panda', vibe: 'Chill', category: 'cute', special: false },
  { name: 'Duckling', vibe: 'Quirky', category: 'cute', special: true },
  { name: 'Koala', vibe: 'Sleepy', category: 'cute', special: false },
  { name: 'Hamster', vibe: 'Tiny', category: 'cute', special: false },
  { name: 'Squirrel', vibe: 'Playful', category: 'cute', special: true },
  { name: 'Ferret', vibe: 'Mischievous', category: 'cute', special: false },
  { name: 'Lamb', vibe: 'Gentle', category: 'cute', special: false },
  { name: 'Fawn', vibe: 'Delicate', category: 'cute', special: true },
  { name: 'Piglet', vibe: 'Cheerful', category: 'cute', special: false },
  { name: 'Kitten', vibe: 'Soft', category: 'cute', special: false },
  { name: 'Chick', vibe: 'Fluffy', category: 'cute', special: true },
  { name: 'Fuzzy Otter', vibe: 'Snuggly', category: 'cute', special: false },
  { name: 'Duck', vibe: 'Goofy', category: 'cute', special: true },
  { name: 'Seal', vibe: 'Cuddly', category: 'cute', special: false },
  { name: 'Penguin', vibe: 'Waddly', category: 'cute', special: false },
  { name: 'Sugar Glider', vibe: 'Airy', category: 'cute', special: true },
  { name: 'Pomeranian', vibe: 'Fluffy', category: 'cute', special: true },
  { name: 'Chinchilla', vibe: 'Velvety', category: 'cute', special: false },
  { name: 'Fennec Fox', vibe: 'Adorable', category: 'cute', special: false },
  { name: 'Red Panda', vibe: 'Cozy', category: 'cute', special: false },
  { name: 'Hedgehog', vibe: 'Spiky-Cute', category: 'cute', special: false },
  { name: 'Capybara', vibe: 'Zen', category: 'cute', special: true },
  { name: 'Baby Elephant', vibe: 'Chunky', category: 'cute', special: false },
  { name: 'Quokka', vibe: 'Smiley', category: 'cute', special: true },
  { name: 'Corgi', vibe: 'Stubby', category: 'cute', special: false },
  { name: 'Mochi Cat', vibe: 'Squishy', category: 'cute', special: true },
];

// ─── Cool Pets ──────────────────────────────────────────────────────────────

export const COOL_PETS: PetDefinition[] = [
  { name: 'Shadow Lynx', vibe: 'Stealthy', category: 'cool', special: false },
  { name: 'Neon Panther', vibe: 'Vibrant', category: 'cool', special: true },
  { name: 'Owl', vibe: 'Wise', category: 'cool', special: false },
  { name: 'Frost Puma', vibe: 'Icy', category: 'cool', special: false },
  { name: 'Midnight Falcon', vibe: 'Sleek', category: 'cool', special: true },
  { name: 'Fox', vibe: 'Clever', category: 'cool', special: false },
  { name: 'Cyber Wolf', vibe: 'Futuristic', category: 'cool', special: true },
  { name: 'Jade Serpent', vibe: 'Smooth', category: 'cool', special: false },
  { name: 'Blue Raven', vibe: 'Edgy', category: 'cool', special: false },
  { name: 'Mystic Koi', vibe: 'Zen', category: 'cool', special: false },
  { name: 'Electric Eel', vibe: 'Zippy', category: 'cool', special: true },
  { name: 'Crimson Puma', vibe: 'Bold', category: 'cool', special: false },
  { name: 'Obsidian Crow', vibe: 'Gritty', category: 'cool', special: true },
  { name: 'Stealth Cat', vibe: 'Sly', category: 'cool', special: false },
  { name: 'Vapor Bat', vibe: 'Smokey', category: 'cool', special: false },
  { name: 'Carbon Leopard', vibe: 'Modern', category: 'cool', special: true },
  { name: 'Onyx Bear', vibe: 'Dominant', category: 'cool', special: false },
  { name: 'Storm Falcon', vibe: 'Dynamic', category: 'cool', special: false },
  { name: 'Arctic Fox', vibe: 'Frosty', category: 'cool', special: false },
  { name: 'Lunar Cat', vibe: 'Ethereal', category: 'cool', special: true },
  { name: 'Ghost Panther', vibe: 'Mysterious', category: 'cool', special: false },
  { name: 'Titanium Hawk', vibe: 'Sharp', category: 'cool', special: false },
  { name: 'Neon Gecko', vibe: 'Flashy', category: 'cool', special: true },
  { name: 'Chrome Salamander', vibe: 'Sleek', category: 'cool', special: false },
  { name: 'Dusk Coyote', vibe: 'Wanderer', category: 'cool', special: false },
  { name: 'Prism Chameleon', vibe: 'Shifting', category: 'cool', special: true },
  { name: 'Phantom Hound', vibe: 'Silent', category: 'cool', special: false },
  { name: 'Iron Raven', vibe: 'Metallic', category: 'cool', special: false },
  { name: 'Slate Wolf', vibe: 'Rugged', category: 'cool', special: false },
  { name: 'Void Cat', vibe: 'Enigmatic', category: 'cool', special: true },
];

// ─── Fierce Pets ────────────────────────────────────────────────────────────

export const FIERCE_PETS: PetDefinition[] = [
  { name: 'Dragon', vibe: 'Bold', category: 'fierce', special: false },
  { name: 'Tiger', vibe: 'Fierce', category: 'fierce', special: false },
  { name: 'Kangaroo', vibe: 'Energetic', category: 'fierce', special: false },
  { name: 'Stag', vibe: 'Noble', category: 'fierce', special: true },
  { name: 'Snow Leopard', vibe: 'Elegant', category: 'fierce', special: false },
  { name: 'Chimera', vibe: 'Chaotic', category: 'fierce', special: true },
  { name: 'Lionheart', vibe: 'Brave', category: 'fierce', special: false },
  { name: 'Bearclaw', vibe: 'Mighty', category: 'fierce', special: false },
  { name: 'Wolverine', vibe: 'Relentless', category: 'fierce', special: true },
  { name: 'Cobra', vibe: 'Venomous', category: 'fierce', special: false },
  { name: 'Eagle', vibe: 'Soaring', category: 'fierce', special: false },
  { name: 'Ravenous Wolf', vibe: 'Wild', category: 'fierce', special: true },
  { name: 'Viper', vibe: 'Sly', category: 'fierce', special: true },
  { name: 'Grizzly', vibe: 'Intimidating', category: 'fierce', special: false },
  { name: 'Raptor', vibe: 'Savage', category: 'fierce', special: true },
  { name: 'Mammoth', vibe: 'Ancient', category: 'fierce', special: false },
  { name: 'Rhino', vibe: 'Sturdy', category: 'fierce', special: false },
  { name: 'Gorilla', vibe: 'Powerful', category: 'fierce', special: false },
  { name: 'Jaguar', vibe: 'Stealthy', category: 'fierce', special: false },
  { name: 'Berserker Boar', vibe: 'Untamed', category: 'fierce', special: true },
  { name: 'Sharktooth', vibe: 'Relentless', category: 'fierce', special: false },
  { name: 'Thunder Bison', vibe: 'Stampeding', category: 'fierce', special: false },
  { name: 'Magma Tortoise', vibe: 'Volcanic', category: 'fierce', special: true },
  { name: 'War Elephant', vibe: 'Unstoppable', category: 'fierce', special: false },
  { name: 'Sabertooth', vibe: 'Primal', category: 'fierce', special: true },
  { name: 'Iron Bull', vibe: 'Stubborn', category: 'fierce', special: false },
  { name: 'Storm Ram', vibe: 'Charging', category: 'fierce', special: false },
  { name: 'Blazing Phoenix', vibe: 'Reborn', category: 'fierce', special: true },
  { name: 'Dire Wolf', vibe: 'Feral', category: 'fierce', special: false },
  { name: 'Kraken Pup', vibe: 'Tentacled', category: 'fierce', special: true },
];

// ─── Mythic Pets ────────────────────────────────────────────────────────────

export const MYTHIC_PETS: PetDefinition[] = [
  { name: 'Unicorn', vibe: 'Dreamy', category: 'mythic', special: false },
  { name: 'Griffin', vibe: 'Majestic', category: 'mythic', special: false },
  { name: 'Merkitten', vibe: 'Magical', category: 'mythic', special: true },
  { name: 'Lantern Spirit', vibe: 'Mystic', category: 'mythic', special: false },
  { name: 'Fairy Fox', vibe: 'Enchanted', category: 'mythic', special: false },
  { name: 'Star Bunny', vibe: 'Celestial', category: 'mythic', special: true },
  { name: 'Phoenix', vibe: 'Reborn', category: 'mythic', special: false },
  { name: 'Celestial Cat', vibe: 'Otherworldly', category: 'mythic', special: false },
  { name: 'Moonlit Pegasus', vibe: 'Soaring', category: 'mythic', special: true },
  { name: 'Spirit Stag', vibe: 'Ethereal', category: 'mythic', special: false },
  { name: 'Mystic Manta', vibe: 'Flowing', category: 'mythic', special: true },
  { name: 'Oracle Owl', vibe: 'Prophetic', category: 'mythic', special: false },
  { name: 'Nebula Narwhal', vibe: 'Cosmic', category: 'mythic', special: true },
  { name: 'Eclipse Eel', vibe: 'Shadowed', category: 'mythic', special: false },
  { name: 'Mystical Moth', vibe: 'Fleeting', category: 'mythic', special: true },
  { name: 'Fae Ferret', vibe: 'Whimsical', category: 'mythic', special: true },
  { name: 'Dream Dragonfly', vibe: 'Illusive', category: 'mythic', special: true },
  { name: 'Celestial Serpent', vibe: 'Serene', category: 'mythic', special: false },
  { name: 'Legendary Lion', vibe: 'Epic', category: 'mythic', special: true },
  { name: 'Crystal Deer', vibe: 'Prismatic', category: 'mythic', special: false },
  { name: 'Astral Jellyfish', vibe: 'Floating', category: 'mythic', special: true },
  { name: 'Ember Sprite', vibe: 'Flickering', category: 'mythic', special: false },
  { name: 'Aurora Fox', vibe: 'Shimmering', category: 'mythic', special: false },
  { name: 'Wish Wisp', vibe: 'Hopeful', category: 'mythic', special: true },
  { name: 'Lore Keeper', vibe: 'Ancient', category: 'mythic', special: false },
  { name: 'Starfall Cat', vibe: 'Radiant', category: 'mythic', special: false },
  { name: 'Arcane Turtle', vibe: 'Wise', category: 'mythic', special: false },
  { name: 'Rainbow Serpent', vibe: 'Vibrant', category: 'mythic', special: true },
  { name: 'Twilight Owl', vibe: 'Mysterious', category: 'mythic', special: false },
  { name: 'Ether Dragon', vibe: 'Transcendent', category: 'mythic', special: true },
];

// ─── Buggy Pets ─────────────────────────────────────────────────────────────

export const BUGGY_PETS: PetDefinition[] = [
  { name: 'Mushroom', vibe: 'Naturey', category: 'buggy', special: false },
  { name: 'Snail', vibe: 'Patient', category: 'buggy', special: false },
  { name: 'Caterpillar', vibe: 'Transformative', category: 'buggy', special: false },
  { name: 'Ladybug', vibe: 'Cheerful', category: 'buggy', special: false },
  { name: 'Firefly', vibe: 'Glowing', category: 'buggy', special: true },
  { name: 'Beetle', vibe: 'Sturdy', category: 'buggy', special: false },
  { name: 'Praying Mantis', vibe: 'Focused', category: 'buggy', special: false },
  { name: 'Grasshopper', vibe: 'Energetic', category: 'buggy', special: true },
  { name: 'Scarab', vibe: 'Ancient', category: 'buggy', special: true },
  { name: 'Butterfly', vibe: 'Graceful', category: 'buggy', special: true },
  { name: 'Moth', vibe: 'Mysterious', category: 'buggy', special: false },
  { name: 'Dragonfly', vibe: 'Agile', category: 'buggy', special: true },
  { name: 'Bumblebee', vibe: 'Buzzing', category: 'buggy', special: false },
  { name: 'Cricket', vibe: 'Melodious', category: 'buggy', special: true },
  { name: 'Pill Bug', vibe: 'Rolly', category: 'buggy', special: false },
  { name: 'Jewel Beetle', vibe: 'Sparkling', category: 'buggy', special: true },
  { name: 'Luna Moth', vibe: 'Ethereal', category: 'buggy', special: false },
  { name: 'Honeybee', vibe: 'Dutiful', category: 'buggy', special: false },
  { name: 'Stick Bug', vibe: 'Camouflaged', category: 'buggy', special: false },
  { name: 'Atlas Moth', vibe: 'Grand', category: 'buggy', special: true },
];

// ─── Aquatic Pets (NEW) ────────────────────────────────────────────────────

export const AQUATIC_PETS: PetDefinition[] = [
  { name: 'Baby Whale', vibe: 'Gentle Giant', category: 'aquatic', special: false },
  { name: 'Clownfish', vibe: 'Cheerful', category: 'aquatic', special: false },
  { name: 'Jellyfish', vibe: 'Flowing', category: 'aquatic', special: false },
  { name: 'Sea Turtle', vibe: 'Wise', category: 'aquatic', special: false },
  { name: 'Octopus', vibe: 'Clever', category: 'aquatic', special: true },
  { name: 'Seahorse', vibe: 'Graceful', category: 'aquatic', special: false },
  { name: 'Dolphin', vibe: 'Playful', category: 'aquatic', special: false },
  { name: 'Starfish', vibe: 'Chill', category: 'aquatic', special: false },
  { name: 'Manta Ray', vibe: 'Majestic', category: 'aquatic', special: true },
  { name: 'Pufferfish', vibe: 'Puffy', category: 'aquatic', special: true },
  { name: 'Baby Shark', vibe: 'Feisty', category: 'aquatic', special: false },
  { name: 'Sea Otter', vibe: 'Cuddly', category: 'aquatic', special: false },
  { name: 'Narwhal', vibe: 'Magical', category: 'aquatic', special: true },
  { name: 'Blobfish', vibe: 'Moody', category: 'aquatic', special: true },
  { name: 'Coral Crab', vibe: 'Snappy', category: 'aquatic', special: false },
  { name: 'Angel Fish', vibe: 'Serene', category: 'aquatic', special: false },
  { name: 'Electric Ray', vibe: 'Sparky', category: 'aquatic', special: true },
  { name: 'Sea Slug', vibe: 'Colorful', category: 'aquatic', special: false },
  { name: 'Pearl Oyster', vibe: 'Hidden Gem', category: 'aquatic', special: false },
  { name: 'Deep Sea Angler', vibe: 'Glowing', category: 'aquatic', special: true },
];

// ─── Cosmic Pets (NEW) ─────────────────────────────────────────────────────

export const COSMIC_PETS: PetDefinition[] = [
  { name: 'Stardust Bunny', vibe: 'Sparkling', category: 'cosmic', special: false },
  { name: 'Nebula Kitten', vibe: 'Swirling', category: 'cosmic', special: false },
  { name: 'Moon Moth', vibe: 'Luminous', category: 'cosmic', special: true },
  { name: 'Solar Fox', vibe: 'Radiant', category: 'cosmic', special: false },
  { name: 'Comet Pup', vibe: 'Speedy', category: 'cosmic', special: false },
  { name: 'Galaxy Whale', vibe: 'Vast', category: 'cosmic', special: true },
  { name: 'Orbit Hamster', vibe: 'Spinning', category: 'cosmic', special: false },
  { name: 'Pulsar Penguin', vibe: 'Rhythmic', category: 'cosmic', special: true },
  { name: 'Void Jellyfish', vibe: 'Drifting', category: 'cosmic', special: false },
  { name: 'Aurora Deer', vibe: 'Shimmering', category: 'cosmic', special: false },
  { name: 'Black Hole Cat', vibe: 'Infinite', category: 'cosmic', special: true },
  { name: 'Saturn Snail', vibe: 'Ringed', category: 'cosmic', special: false },
  { name: 'Star Salamander', vibe: 'Glittering', category: 'cosmic', special: false },
  { name: 'Supernova Owl', vibe: 'Explosive', category: 'cosmic', special: true },
  { name: 'Plasma Panda', vibe: 'Energized', category: 'cosmic', special: false },
  { name: 'Meteor Mouse', vibe: 'Blazing', category: 'cosmic', special: false },
  { name: 'Gravity Bear', vibe: 'Heavy', category: 'cosmic', special: true },
  { name: 'Warp Weasel', vibe: 'Teleporting', category: 'cosmic', special: false },
  { name: 'Eclipse Moth', vibe: 'Shadowed', category: 'cosmic', special: true },
  { name: 'Constellation Fox', vibe: 'Mapped', category: 'cosmic', special: false },
];

// ─── All Pets By Category ───────────────────────────────────────────────────

export const PET_CATEGORIES: Record<PetCategory, PetDefinition[]> = {
  cute: CUTE_PETS,
  cool: COOL_PETS,
  fierce: FIERCE_PETS,
  mythic: MYTHIC_PETS,
  buggy: BUGGY_PETS,
  aquatic: AQUATIC_PETS,
  cosmic: COSMIC_PETS,
};

/** Flat list of every pet */
export const ALL_PETS: PetDefinition[] = Object.values(PET_CATEGORIES).flat();

// ─── Color Palettes ─────────────────────────────────────────────────────────

export const LIGHT_COLORS: ColorCombo[] = [
  { base: '#FADADD', secondary: '#F9AFAE' },
  { base: '#D7F9F1', secondary: '#B2E2DA' },
  { base: '#FFF1D7', secondary: '#FFD8A8' },
  { base: '#E5D1FF', secondary: '#C7B1FF' },
  { base: '#FFE3E1', secondary: '#FFC7C7' },
  { base: '#DCF6E8', secondary: '#AEEACE' },
  { base: '#D0E6FF', secondary: '#A4CFFF' },
  { base: '#FFF9E5', secondary: '#FFEFCF' },
  { base: '#FBE4FF', secondary: '#E9C1FF' },
  { base: '#FAE3F4', secondary: '#F7C1E2' },
  { base: '#E8F0FE', secondary: '#D0E1FD' },
  { base: '#FFF0F5', secondary: '#FFCCE5' },
  { base: '#E0FFFA', secondary: '#B3FFF1' },
  { base: '#F3E8FF', secondary: '#DEC7FF' },
  { base: '#FDF6F0', secondary: '#FDE2D0' },
  { base: '#C8F9D2', secondary: '#9FE6B8' },
  { base: '#F9D8E6', secondary: '#F6A5C0' },
  { base: '#D9F8FF', secondary: '#BCEFFF' },
  { base: '#FFE9F3', secondary: '#FFCFE2' },
  { base: '#E6FFFA', secondary: '#B2FCEF' },
];

export const DARK_COLORS: ColorCombo[] = [
  { base: '#1B1B2F', secondary: '#2C2C54' },
  { base: '#2F1B1B', secondary: '#5A3D3D' },
  { base: '#1E263C', secondary: '#3A4F7A' },
  { base: '#2B1D3A', secondary: '#5B3C73' },
  { base: '#2E2A1E', secondary: '#5C5238' },
  { base: '#1A222F', secondary: '#324B6B' },
  { base: '#1E1E1E', secondary: '#3B3B3B' },
  { base: '#202F2F', secondary: '#3F5D5D' },
  { base: '#2C1A33', secondary: '#5B4080' },
  { base: '#19222D', secondary: '#35526A' },
];

// ─── Personality → Category Mapping ─────────────────────────────────────────

/**
 * Maps a user's personality vibe + companion preference into weighted pet categories.
 * Returns 1-3 categories that best match the user's answers.
 */
export function matchCategories(
  personalityVibe: string,
  companionStyle: string,
): PetCategory[] {
  const vibeMap: Record<string, PetCategory[]> = {
    chill:       ['cute', 'aquatic'],
    adventurous: ['fierce', 'cool'],
    mysterious:  ['mythic', 'cosmic'],
    creative:    ['mythic', 'buggy'],
    energetic:   ['fierce', 'cool'],
    dreamy:      ['cosmic', 'mythic'],
  };

  const companionMap: Record<string, PetCategory[]> = {
    cuddly:  ['cute', 'aquatic'],
    brave:   ['fierce', 'cool'],
    magical: ['mythic', 'cosmic'],
    quirky:  ['buggy', 'aquatic'],
    sleek:   ['cool', 'cosmic'],
  };

  const vibeCategories = vibeMap[personalityVibe] ?? ['cute'];
  const companionCategories = companionMap[companionStyle] ?? ['cute'];

  const merged = [...new Set([...vibeCategories, ...companionCategories])];
  return merged.slice(0, 3) as PetCategory[];
}

/**
 * Randomly selects `count` unique pets from the given categories,
 * each assigned a UNIQUE color combo (no two pets share the same colors).
 */
export function pickRandomPets(categories: PetCategory[], count = 3): GeneratedPet[] {
  const pool = categories.flatMap((cat) => PET_CATEGORIES[cat] ?? []);
  const shuffled = pool.sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, count);

  const useDark = Math.random() < 0.2;
  const colorPool = useDark ? DARK_COLORS : LIGHT_COLORS;
  const shuffledColors = [...colorPool].sort(() => Math.random() - 0.5);

  return picked.map((pet, i) => {
    const color = shuffledColors[i % shuffledColors.length];
    return {
      ...pet,
      baseColor: color.base,
      secondaryColor: color.secondary,
    };
  });
}

// ─── Image Prompt ───────────────────────────────────────────────────────────

/** Builds the prompt sent to GPT-image-1-mini for pet generation */
export function buildPetImagePrompt(pet: GeneratedPet): string {
  return `Create a cute, digital art style illustration of a ${pet.name} with a ${pet.vibe} vibe.
The color palette should be ${pet.baseColor} and ${pet.secondaryColor}.
The art style should be chibi and adorable with a bold black outline around the pet. The pet should have no nose. No random artifacts on the face.
MOUTH (critical): use a tiny simple closed smile only — a short soft black curved line or tiny "u". Do NOT draw an open mouth, gaping hole, dark red/black void inside the mouth, visible tongue, teeth, or a solid red/pink oval sticker mouth. Keep the mouth minimal like a kawaii line-art smile.
It should appear as a baby level 1 pet, so it should look small, squishy and innocent. The pet should be happy and expressive — no sadness, anger, or neutral expressions.
There must be no text, numbers, or logos in the image.
IMPORTANT: The background must be 100% transparent (PNG with alpha).
The pet should be centered and occupy most of the frame with no background objects.`;
}
