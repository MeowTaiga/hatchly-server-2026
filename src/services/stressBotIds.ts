/** Shared stress-test bot id helpers (avoid circular imports). */

export const BOT_ID_PREFIX = 'bot_stress_';

export function isStressBot(userId: string): boolean {
  return typeof userId === 'string' && userId.startsWith(BOT_ID_PREFIX);
}
