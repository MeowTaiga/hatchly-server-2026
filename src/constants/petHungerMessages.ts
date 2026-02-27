/**
 * Cute, varied messages when a pet is hungry.
 * Placeholders: {username} (display name), {customName} (pet nickname).
 */
const TEMPLATES = [
  'Hey {username}, {customName} is getting hangry!',
  'Psst... {customName} hasn\'t eaten in a while!',
  'Om nom nom? {customName} is ready for a snack!',
  '{customName} says: Feed me, {username}!',
  'Rumble rumble... {customName}\'s tummy is talking!',
  '{username}, {customName} needs you! (and also food)',
  'Hunger level: critical! - Love, {customName}',
  '{customName} is doing their best hungry face. Help?',
  'Snack time? {customName} votes yes!',
  '{username}! {customName} is dreaming about treats.',
  'Emergency broadcast from {customName}: I\'m hungry!',
  'Food o\'clock, according to {customName}.',
  '{customName} would like to order one (1) snack, please.',
  'Attention {username}: {customName} needs sustenance!',
  'The great {customName} requests nourishment.',
  '{customName} has entered low-energy mode. Snacks required.',
  'Hey {username}... {customName} could use a little fuel.',
  '{customName}\'s food meter is beeping. You\'re their hero!',
  'Break time? {customName} thinks it\'s break time.',
  'Treat alert! {customName} is waiting by the bowl.',
  '{username}, {customName} sent a hunger signal. 📡',
  '{customName} is doing the hungry wiggle. You know the one.',
  'Snack emergency! - {customName}',
  '{customName} whispers: I could really use a nibble.',
  'Food radar activated. {customName} has located you.',
  '{username}, your buddy {customName} needs a boost!',
  'The tummy rumbles. {customName} awaits.',
  'Hunger o\'clock! - {customName}',
  '{customName} is giving you the snack eyes. You know the ones.',
  'Priority message: {customName} is hungry. Over.',
];

/**
 * Picks a random hunger message and substitutes placeholders.
 */
export function pickHungerMessage(username: string, customName: string): string {
  const t = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
  return t.replace(/\{username\}/g, username).replace(/\{customName\}/g, customName);
}
