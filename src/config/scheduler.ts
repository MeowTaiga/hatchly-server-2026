/**
 * Configuration for the periodic scheduler and its jobs.
 * Central place for intervals and thresholds — extend as new jobs are added.
 */

/** Interval (ms) between pet hunger depletion runs. Default: 5 minutes. */
export const HUNGER_DEPLETION_INTERVAL_MS = 5 * 60 * 1000;

/** Interval (ms) between pet hunger notification checks. Default: 1 hour. */
export const HUNGER_NOTIFICATION_INTERVAL_MS = 60 * 60 * 1000;

/** Hunger level below which we notify the user. Pet schema: 0–100, low = hungry. */
export const HUNGER_THRESHOLD = 40;

/** Amount to decrement from each pet's hunger per depletion run. */
export const HUNGER_DEPLETION_AMOUNT = 1;
