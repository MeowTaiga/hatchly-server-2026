/**
 * Shared US world weather / event calendar.
 *
 * Clock: America/New_York so every player (and multiplayer scenes) see the same day.
 * Precipitation days are deterministic per month (3–7). Special timed events can
 * override precip. Next step for ops: move SPECIAL_EVENTS into a Mongo WorldEvent
 * collection so schedules can change without deploys.
 */

export const WEATHER_TZ = 'America/New_York';

export type WeatherType = 'clear' | 'rain' | 'snow' | 'meteor_shower';

export interface ActiveWeather {
  type: WeatherType;
  /** YYYY-MM-DD in America/New_York */
  date: string;
  label?: string;
  /** ISO end time for timed special events */
  endsAt?: string;
}

export interface SpecialWeatherEvent {
  type: Exclude<WeatherType, 'clear' | 'rain' | 'snow'>;
  /** Inclusive start (ISO 8601 with offset preferred). */
  start: string;
  /** Exclusive end. */
  end: string;
  label?: string;
}

/** Winter months → snow on precip days; otherwise rain. */
const WINTER_MONTHS = new Set([12, 1, 2]);

/**
 * Hand-authored special events. Keep short; migrate to Mongo when ops need live edits.
 * Example meteor window (adjust dates as needed).
 */
export const SPECIAL_EVENTS: readonly SpecialWeatherEvent[] = [
  {
    type: 'meteor_shower',
    start: '2026-08-12T01:00:00-04:00',
    end: '2026-08-12T04:00:00-04:00',
    label: 'Perseid Meteor Shower',
  },
  {
    type: 'meteor_shower',
    start: '2026-12-13T22:00:00-05:00',
    end: '2026-12-14T03:00:00-05:00',
    label: 'Geminid Meteor Shower',
  },
];

// ─── Date helpers ────────────────────────────────────────────────────────────

function partsInTz(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')?.value ?? '0');
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? '0');
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? '0');
  return { year, month, day };
}

export function getWeatherDateStr(now: Date = new Date()): string {
  const { year, month, day } = partsInTz(now, WEATHER_TZ);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Mulberry32 — small deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Returns sorted unique precip day-of-month values (3–7) for the given month.
 * Stable across process restarts for the same year/month.
 */
export function getPrecipDays(year: number, month: number): number[] {
  const dim = daysInMonth(year, month);
  const rng = mulberry32(year * 100 + month);
  const count = 3 + Math.floor(rng() * 5); // 3..7
  const days = new Set<number>();
  // Cap attempts so we always fill even on tiny months
  let guard = 0;
  while (days.size < count && guard < 200) {
    days.add(1 + Math.floor(rng() * dim));
    guard += 1;
  }
  return [...days].sort((a, b) => a - b);
}

function precipTypeForMonth(month: number): 'rain' | 'snow' {
  return WINTER_MONTHS.has(month) ? 'snow' : 'rain';
}

function findActiveSpecial(now: Date, events: readonly SpecialWeatherEvent[] = SPECIAL_EVENTS): SpecialWeatherEvent | null {
  const t = now.getTime();
  for (const ev of events) {
    const start = Date.parse(ev.start);
    const end = Date.parse(ev.end);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    if (t >= start && t < end) return ev;
  }
  return null;
}

/**
 * Resolve current world weather.
 * Priority: special timed event > precipitation > clear.
 */
export function getActiveWeather(
  now: Date = new Date(),
  events: readonly SpecialWeatherEvent[] = SPECIAL_EVENTS,
): ActiveWeather {
  const date = getWeatherDateStr(now);
  const special = findActiveSpecial(now, events);
  if (special) {
    return {
      type: special.type,
      date,
      label: special.label,
      endsAt: new Date(special.end).toISOString(),
    };
  }

  const { year, month, day } = partsInTz(now, WEATHER_TZ);
  const precipDays = getPrecipDays(year, month);
  if (precipDays.includes(day)) {
    return { type: precipTypeForMonth(month), date };
  }

  return { type: 'clear', date };
}

export const weatherService = {
  getActiveWeather,
  getPrecipDays,
  getWeatherDateStr,
};
