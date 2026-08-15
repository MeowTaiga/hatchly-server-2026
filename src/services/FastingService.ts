import { FastingPrefs } from '../models/FastingPrefs.js';
import { FastingSession, type IFastingSession } from '../models/FastingSession.js';
import { getTodayDateStr } from '../utils/getYesterdaySummary.js';
import { AppError } from '../middleware/errorHandler.js';
import { createLogger } from '../config/logger.js';
import { notificationService } from './NotificationService.js';

const log = createLogger('FastingService');

export const FASTING_HOURS_MIN = 12;
export const FASTING_HOURS_MAX = 24;

export interface PublicFastingSession {
  id: string;
  goalHours: number;
  startedAt: string;
  endsAt: string;
  endedAt?: string;
  status: 'active' | 'completed' | 'broken';
  remainingMs: number;
}

export interface FastingState {
  interested: boolean | null;
  active: PublicFastingSession | null;
}

function toPublic(session: IFastingSession, now = Date.now()): PublicFastingSession {
  const remainingMs = Math.max(0, session.endsAt.getTime() - now);
  return {
    id: session.id || String(session._id),
    goalHours: session.goalHours,
    startedAt: session.startedAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    ...(session.endedAt && { endedAt: session.endedAt.toISOString() }),
    status: session.status,
    remainingMs: session.status === 'active' ? remainingMs : 0,
  };
}

export async function getFastingState(userId: string): Promise<FastingState> {
  const [prefs, active] = await Promise.all([
    FastingPrefs.findOne({ userId }).lean(),
    FastingSession.findOne({ userId, status: 'active' }).sort({ startedAt: -1 }),
  ]);
  return {
    interested: prefs ? prefs.interested : null,
    active: active ? toPublic(active) : null,
  };
}

export async function setFastingInterest(userId: string, interested: boolean): Promise<FastingState> {
  await FastingPrefs.findOneAndUpdate(
    { userId },
    { $set: { interested } },
    { upsert: true, new: true },
  );
  log.info({ userId, interested }, 'Fasting interest saved');
  return getFastingState(userId);
}

export async function startFast(
  userId: string,
  goalHours: number,
  timezone?: string,
): Promise<FastingState> {
  if (!Number.isInteger(goalHours) || goalHours < FASTING_HOURS_MIN || goalHours > FASTING_HOURS_MAX) {
    throw new AppError(`Pick a fast between ${FASTING_HOURS_MIN} and ${FASTING_HOURS_MAX} hours`, 400, 'INVALID_FAST_LENGTH');
  }

  const prefs = await FastingPrefs.findOne({ userId }).lean();
  if (!prefs?.interested) {
    throw new AppError('Turn on fasting first', 400, 'FASTING_NOT_ENABLED');
  }

  const existing = await FastingSession.findOne({ userId, status: 'active' });
  if (existing) {
    const now = new Date();
    existing.status = now >= existing.endsAt ? 'completed' : 'broken';
    existing.endedAt = now;
    await existing.save();
  }

  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + goalHours * 60 * 60 * 1000);
  await FastingSession.create({
    userId,
    date: getTodayDateStr(timezone),
    goalHours,
    startedAt,
    endsAt,
    status: 'active',
  });
  log.info({ userId, goalHours }, 'Fast started');
  return getFastingState(userId);
}

export async function endFast(userId: string): Promise<FastingState> {
  const active = await FastingSession.findOne({ userId, status: 'active' }).sort({ startedAt: -1 });
  if (!active) throw new AppError('No active fast', 404, 'NO_ACTIVE_FAST');

  const now = new Date();
  active.status = now >= active.endsAt ? 'completed' : 'broken';
  active.endedAt = now;
  await active.save();
  log.info({ userId, status: active.status }, 'Fast ended');
  return getFastingState(userId);
}

/**
 * Push + in-app notify for fasts whose timer just hit zero.
 * Claims each session first so overlapping job ticks can't double-send.
 */
export async function notifyCompletedFasts(): Promise<void> {
  const due = await FastingSession.find({
    status: 'active',
    endsAt: { $lte: new Date() },
    notifiedAt: { $exists: false },
  })
    .select('_id userId goalHours')
    .limit(200)
    .lean();

  for (const session of due) {
    const claimed = await FastingSession.findOneAndUpdate(
      { _id: session._id, status: 'active', notifiedAt: { $exists: false } },
      { $set: { notifiedAt: new Date() } },
    );
    if (!claimed) continue;

    const userId = String(session.userId);
    try {
      await notificationService.createAndDeliver(userId, 'fasting_complete', {
        goalHours: session.goalHours,
        sessionId: String(session._id),
      });
      log.info({ userId, sessionId: String(session._id), goalHours: session.goalHours }, 'Fasting complete notification sent');
    } catch (err) {
      log.error({ err, userId, sessionId: String(session._id) }, 'Fasting complete notification failed');
    }
  }
}

/** One-line snapshot for pet chat. */
export async function getFastingChatContext(userId: string): Promise<string | null> {
  const state = await getFastingState(userId);
  if (state.interested !== true) return null;
  if (!state.active) return 'fasting on, no active fast';
  const { goalHours, remainingMs, startedAt, endsAt } = state.active;
  if (remainingMs <= 0) {
    return `${goalHours}h fast finished (started ${startedAt}, goal ${endsAt})`;
  }
  const mins = Math.round(remainingMs / 60_000);
  const hoursLeft = Math.floor(mins / 60);
  const minsLeft = mins % 60;
  return `${goalHours}h fast in progress, ${hoursLeft}h ${minsLeft}m left (ends ${endsAt})`;
}
