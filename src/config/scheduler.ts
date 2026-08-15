/**
 * Configuration for the periodic scheduler and its jobs.
 * Central place for intervals and thresholds — extend as new jobs are added.
 */

/** Interval (ms) between pet hunger depletion runs. Default: 7.5 minutes (~33% slower than 5 min). */
export const HUNGER_DEPLETION_INTERVAL_MS = 7.5 * 60 * 1000;

/** Interval (ms) between pet hunger notification checks. Default: 1 hour. */
export const HUNGER_NOTIFICATION_INTERVAL_MS = 60 * 60 * 1000;

/** Hunger level below which we notify the user. Pet schema: 0–100, low = hungry. */
export const HUNGER_THRESHOLD = 40;

/** Amount to decrement from each pet's hunger per depletion run. */
export const HUNGER_DEPLETION_AMOUNT = 1;

/** Interval (ms) between fasting-complete notification checks. */
export const FASTING_COMPLETE_INTERVAL_MS = 30 * 1000;

/** Interval (ms) between goal-reminder checks. */
export const GOAL_REMINDER_INTERVAL_MS = 60 * 1000;
