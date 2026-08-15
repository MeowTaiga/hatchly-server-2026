import { notifyCompletedFasts } from '../services/FastingService.js';

/**
 * Notifies users whose fasting timer has reached zero.
 * Runs every 30s; FastingService claims each session so ticks can't double-send.
 */
export async function runFastingCompleteNotification(): Promise<void> {
  await notifyCompletedFasts();
}
