/**
 * Registry of suggestion types the pet AI can recommend.
 * Add new types here to extend the system — frontend maps component id to UI.
 */
export interface SuggestionTypeDef {
  id: string;
  title: string;
  /** Default content template; AI can customize. */
  defaultContent: string;
  /** Shown to AI so it knows when to suggest this. */
  description: string;
}

export const SUGGESTION_TYPES: SuggestionTypeDef[] = [
  {
    id: 'stretch',
    title: 'Short stretch',
    defaultContent: 'Do 5 mins of neck and shoulder stretches',
    description: 'Stretching, flexibility, muscle relief',
  },
  {
    id: 'walk',
    title: 'Short walk',
    defaultContent: 'Take a 5–10 min walk outside or around the room',
    description: 'Walking, movement, get up from desk',
  },
  {
    id: 'zen',
    title: 'Zen meditation',
    defaultContent: 'Sit quietly for 5 mins — focus on your breath or a mantra',
    description: 'Meditation, mindfulness, zen, calm',
  },
  {
    id: 'music',
    title: 'Listen to favorite song',
    defaultContent: 'Put on your favorite song and really listen',
    description: 'Music, favorite song, listen, mood boost',
  },
  {
    id: 'bake',
    title: 'Bake something new',
    defaultContent: 'Bake something you\'ve never baked before',
    description: 'Baking, try new recipe, creative cooking',
  },
  {
    id: 'journal',
    title: 'Quick journal',
    defaultContent: 'Write for 5 mins — how you feel, what\'s on your mind',
    description: 'Journaling, writing, reflection',
  },
  {
    id: 'call_friend',
    title: 'Ring a friend',
    defaultContent: 'Call or text someone you\'ve been meaning to reach out to',
    description: 'Social connection, call friend, reach out',
  },
  {
    id: 'read',
    title: 'Read a chapter',
    defaultContent: 'Read one chapter of a book you\'re into',
    description: 'Reading, book, unwind',
  },
  {
    id: 'breathe',
    title: 'Breathe',
    defaultContent: 'Take 10 deep breaths — 4 sec in, 4 sec hold, 6 sec out',
    description: 'Breathing exercises, calm down, reset',
  },
  {
    id: 'water',
    title: 'Drink water',
    defaultContent: 'Drink a full glass of water',
    description: 'Hydration, drink water',
  },
  {
    id: 'gratitude',
    title: 'Quick gratitude',
    defaultContent: 'Think of 3 things you\'re grateful for right now',
    description: 'Gratitude, reflection, positive mindset',
  },
];

export const SUGGESTION_IDS = SUGGESTION_TYPES.map((s) => s.id);

export function getSuggestionType(id: string): SuggestionTypeDef | undefined {
  return SUGGESTION_TYPES.find((s) => s.id === id);
}
