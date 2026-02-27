import { registerJob } from '../services/SchedulerService.js';
import { runHungerDepletion, runHungerNotification } from './petHunger.js';
import {
  HUNGER_DEPLETION_INTERVAL_MS,
  HUNGER_NOTIFICATION_INTERVAL_MS,
} from '../config/scheduler.js';

/**
 * Registers all periodic jobs with the scheduler.
 * Call once before startScheduler().
 */
export function registerAllJobs(): void {
  registerJob('hunger_depletion', runHungerDepletion, HUNGER_DEPLETION_INTERVAL_MS);
  registerJob('hunger_notification', runHungerNotification, HUNGER_NOTIFICATION_INTERVAL_MS);
}
