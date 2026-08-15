import mongoose from 'mongoose';
import { UserGoal, type IUserGoal, type GoalRepeatKind } from '../models/UserGoal.js';
import { GoalCompletion } from '../models/GoalCompletion.js';
import { SharedGoal } from '../models/SharedGoal.js';
import { SharedGoalCompletion } from '../models/SharedGoalCompletion.js';
import { Marriage, otherSpouse } from '../models/Marriage.js';
import { User } from '../models/User.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { getTodayDateStr } from '../utils/getYesterdaySummary.js';
import { AppError } from '../middleware/errorHandler.js';
import { createLogger } from '../config/logger.js';
import { farmService } from './FarmService.js';
import { grantLoot } from './inventoryCapacity.js';
import { pickGoalRewardItem } from './GoalRewardService.js';
import { skillXpService } from './SkillXpService.js';
import { notificationService } from './NotificationService.js';
import {
  endMarriage,
  findMarriageForUser,
  getMarriagePublic,
  proposeMarriage,
  requireMarried,
  respondToMarriage,
  type MarriagePublic,
} from './MarriageService.js';
import {
  GOAL_CATALOG,
  GOAL_CUSTOM_DEFAULT_REMIND_AT,
  GOAL_DEFAULT_REWARD_ITEM,
  DEFAULT_SECTION_ICONS,
  GOAL_HEALTH_XP,
  GOAL_ICON_PICKER,
  GOAL_MAX_REWARDED_PER_DAY,
  GOAL_SOCIAL_XP,
  catalogEntryById,
} from '../constants/goalCatalog.js';

const log = createLogger('GoalService');

const TITLE_MAX = 80;
const SECTION_MAX = 32;
const REMIND_AT_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface PublicGoal {
  id: string;
  source: 'catalog' | 'custom' | 'shared';
  catalogId?: string;
  title: string;
  notes?: string;
  iconItemType: string;
  iconImageUrl?: string;
  iconEmoji?: string;
  rewardItemType: string;
  repeat: GoalRepeatKind;
  repeatDays: number[];
  remindAt?: string;
  enabled: boolean;
  dueToday: boolean;
  completedToday: boolean;
  completedByUsername?: string;
  section?: string;
  sectionIconItemType?: string;
  sortOrder: number;
}

export interface GoalRewardPayload {
  xpGained: number;
  healthXp: number;
  socialXp: number;
  item?: { itemType: string; label: string; imageUrl?: string; emoji?: string; qty: number };
}

export interface GoalsTodayState {
  dateStr: string;
  dueCount: number;
  completedCount: number;
  rewardedCount: number;
  goals: PublicGoal[];
  sharedGoals: PublicGoal[];
  marriage: MarriagePublic | null;
  catalog: Array<{
    id: string;
    title: string;
    iconItemType: string;
    iconImageUrl?: string;
    iconEmoji?: string;
    enabled: boolean;
  }>;
  iconPicker: string[];
  iconArt: Record<string, { imageUrl?: string; emoji?: string }>;
}

export interface GoalHistoryDay {
  date: string;
  due: number;
  completed: number;
}

export interface GoalHistoryState {
  start: string;
  end: string;
  days: GoalHistoryDay[];
  due: number;
  completed: number;
  daysWithGoals: number;
  perfectDays: number;
  showUpDays: number;
  streak: number;
  bestStreak: number;
  rate: number;
}

export interface ChatGoalCardGoal {
  id: string;
  title: string;
  notes?: string;
  iconItemType: string;
  iconImageUrl?: string;
  iconEmoji?: string;
  repeat: GoalRepeatKind;
  repeatDays: number[];
  remindAt?: string;
  dueToday: boolean;
  completedToday: boolean;
}

export interface ChatGoalCard {
  kind: 'created' | 'complete';
  alreadyExisted?: boolean;
  goal: ChatGoalCardGoal;
}

export function publicGoalToChatCardGoal(goal: PublicGoal): ChatGoalCardGoal {
  return {
    id: goal.id,
    title: goal.title,
    ...(goal.notes ? { notes: goal.notes } : {}),
    iconItemType: goal.iconItemType,
    ...(goal.iconImageUrl ? { iconImageUrl: goal.iconImageUrl } : {}),
    ...(goal.iconEmoji ? { iconEmoji: goal.iconEmoji } : {}),
    repeat: goal.repeat,
    repeatDays: goal.repeatDays,
    ...(goal.remindAt ? { remindAt: goal.remindAt } : {}),
    dueToday: goal.dueToday,
    completedToday: goal.completedToday,
  };
}

export function formatGoalsForPrompt(state: GoalsTodayState): string {
  const enabled = state.goals.filter((g) => g.enabled);
  const off = state.catalog.filter((c) => !c.enabled);
  const lines = enabled.map((g) => {
    const kind = g.source === 'catalog' ? `premade:${g.catalogId}` : 'custom';
    const sched =
      g.repeat === 'daily' ? 'daily' : g.repeat === 'once' ? 'once' : `weekdays ${g.repeatDays.join(',')}`;
    const due = !g.dueToday ? 'not due today' : g.completedToday ? 'done today' : 'due today';
    return `${g.id} | ${kind} | ${g.title} | ${due} | ${sched}`;
  });
  const body = lines.length ? lines.join('\n') : 'None enabled.';
  const offLine = off.length
    ? `\nPremade catalog off (toggle only, do not treat as blocking custom goals): ${off.map((c) => `${c.id}="${c.title}"`).join(', ')}.`
    : '';
  return `${body}${offLine}`;
}

export interface CreateCustomGoalInput {
  title: string;
  notes?: string;
  iconItemType?: string;
  repeat?: GoalRepeatKind;
  repeatDays?: number[];
  remindAt?: string | null;
  section?: string | null;
  sectionIconItemType?: string;
}

export interface UpdateGoalInput {
  title?: string;
  notes?: string | null;
  iconItemType?: string;
  repeat?: GoalRepeatKind;
  repeatDays?: number[];
  remindAt?: string | null;
  section?: string | null;
  sectionIconItemType?: string;
  enabled?: boolean;
}

function localWeekday(timezone?: string): number {
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    weekday: 'short',
  }).format(new Date());
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(short);
}

function localTimeHm(timezone?: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone || 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

function isDueToday(goal: { enabled: boolean; archived: boolean; repeat: GoalRepeatKind; repeatDays?: number[] }, weekday: number): boolean {
  if (!goal.enabled || goal.archived) return false;
  if (goal.repeat === 'once' || goal.repeat === 'daily') return true;
  return Array.isArray(goal.repeatDays) && goal.repeatDays.includes(weekday);
}

function toPublic(goal: IUserGoal, weekday: number, completedIds: Set<string>): PublicGoal {
  const id = goal.id || String(goal._id);
  return {
    id,
    source: goal.source,
    ...(goal.catalogId ? { catalogId: goal.catalogId } : {}),
    title: goal.title,
    ...(goal.notes ? { notes: goal.notes } : {}),
    iconItemType: goal.iconItemType,
    rewardItemType: goal.rewardItemType,
    repeat: goal.repeat,
    repeatDays: goal.repeatDays ?? [],
    ...(goal.remindAt ? { remindAt: goal.remindAt } : {}),
    ...(goal.section ? { section: goal.section } : {}),
    ...(goal.sectionIconItemType ? { sectionIconItemType: goal.sectionIconItemType } : {}),
    enabled: goal.enabled,
    dueToday: isDueToday(goal, weekday),
    completedToday: completedIds.has(id),
    sortOrder: goal.sortOrder,
  };
}

function normalizeRepeatDays(days?: number[]): number[] {
  if (!days?.length) return [];
  const uniq = [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  uniq.sort((a, b) => a - b);
  return uniq;
}

function normalizeRemindAt(value: string | null | undefined): string | undefined {
  if (value == null || value === '') return undefined;
  if (!REMIND_AT_RE.test(value)) {
    throw new AppError('Reminder time must be HH:mm (24h)', 400, 'INVALID_REMIND_AT');
  }
  return value;
}

function normalizeSection(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const next = value.trim().replace(/\s+/g, ' ');
  if (!next) return undefined;
  if (next.length > SECTION_MAX) {
    throw new AppError('Section name is too long', 400, 'GOAL_SECTION_TOO_LONG');
  }
  return next;
}

function pickerIcon(type?: string | null): string | undefined {
  if (!type) return undefined;
  return GOAL_ICON_PICKER.includes(type) ? type : undefined;
}

function defaultSectionIcon(section?: string): string {
  if (!section) return DEFAULT_SECTION_ICONS.__general;
  return DEFAULT_SECTION_ICONS[section] ?? 'open_notebook';
}

function sectionMatchFilter(section?: string): Record<string, unknown> {
  if (section) return { section };
  return { $or: [{ section: { $exists: false } }, { section: null }, { section: '' }] };
}

async function syncSectionIcon(opts: {
  userId?: string;
  marriageId?: mongoose.Types.ObjectId;
  section?: string;
  iconItemType: string;
}): Promise<void> {
  const icon = pickerIcon(opts.iconItemType);
  if (!icon) return;
  const filter = {
    archived: false,
    ...sectionMatchFilter(opts.section),
    ...(opts.userId ? { userId: opts.userId } : {}),
    ...(opts.marriageId ? { marriageId: opts.marriageId } : {}),
  };
  if (opts.marriageId) {
    await SharedGoal.updateMany(filter, { $set: { sectionIconItemType: icon } });
  } else if (opts.userId) {
    await UserGoal.updateMany(filter, { $set: { sectionIconItemType: icon } });
  }
}

async function timezoneOf(userId: string): Promise<string | undefined> {
  const user = await User.findById(userId).select('timezone').lean();
  return user?.timezone;
}

let catalogIndexFixed = false;
async function ensureCustomGoalsNotBlockedByCatalogIndex(): Promise<void> {
  if (catalogIndexFixed) return;
  try {
    await UserGoal.collection.dropIndex('userId_1_catalogId_1');
  } catch {
    // already dropped
  }
  await UserGoal.updateMany({ source: 'custom' }, { $unset: { catalogId: 1 } });
  catalogIndexFixed = true;
}

let completionIndexesReady = false;
async function ensureCompletionIndexes(): Promise<void> {
  if (completionIndexesReady) return;
  try {
    try {
      await GoalCompletion.collection.dropIndex('userId_1_dateStr_1_rewardSlot_1');
    } catch {
      // missing or already the partial unique index
    }
    await GoalCompletion.createIndexes();
  } catch (err) {
    log.warn({ err }, 'GoalCompletion indexes not ready');
    return;
  }
  completionIndexesReady = true;
}

async function ensureCatalog(userId: string): Promise<void> {
  await ensureCustomGoalsNotBlockedByCatalogIndex();
  const existing = await UserGoal.find({ userId, source: 'catalog' }).select('catalogId remindAt').lean();
  const have = new Set(existing.map((g) => g.catalogId).filter(Boolean));
  const missing = GOAL_CATALOG.filter((e) => !have.has(e.id));
  if (missing.length) {
    await UserGoal.insertMany(
      missing.map((e, i) => ({
        userId,
        source: 'catalog' as const,
        catalogId: e.id,
        title: e.title,
        iconItemType: e.iconItemType,
        rewardItemType: e.rewardItemType,
        repeat: 'daily' as const,
        repeatDays: [],
        remindAt: e.defaultRemindAt,
        enabled: e.defaultEnabled,
        archived: false,
        sortOrder: i,
      })),
    );
    log.info({ userId, added: missing.length }, 'Seeded goal catalog');
  }

  const needRemind = existing.filter((g) => g.catalogId && !g.remindAt);
  if (needRemind.length) {
    await Promise.all(
      needRemind.map((g) => {
        const entry = catalogEntryById(g.catalogId!);
        if (!entry) return Promise.resolve();
        return UserGoal.updateOne(
          { _id: g._id, $or: [{ remindAt: { $exists: false } }, { remindAt: null }, { remindAt: '' }] },
          { $set: { remindAt: entry.defaultRemindAt } },
        );
      }),
    );
  }
}

async function loadIconArt(itemTypes: string[]): Promise<Record<string, { imageUrl?: string; emoji?: string }>> {
  const types = [...new Set(itemTypes.filter(Boolean))];
  if (!types.length) return {};
  const defs = await GameItemDef.find({ itemType: { $in: types } })
    .select('itemType imageUrl emoji')
    .lean();
  const art: Record<string, { imageUrl?: string; emoji?: string }> = {};
  for (const d of defs) {
    art[d.itemType] = {
      ...(d.imageUrl ? { imageUrl: d.imageUrl } : {}),
      ...(d.emoji ? { emoji: d.emoji } : {}),
    };
  }
  return art;
}

function withIconArt<T extends { iconItemType: string }>(
  row: T,
  art: Record<string, { imageUrl?: string; emoji?: string }>,
): T & { iconImageUrl?: string; iconEmoji?: string } {
  const hit = art[row.iconItemType];
  return {
    ...row,
    ...(hit?.imageUrl ? { iconImageUrl: hit.imageUrl } : {}),
    ...(hit?.emoji ? { iconEmoji: hit.emoji } : {}),
  };
}

async function settleOnceGoals(opts: {
  userId?: string;
  marriageId?: mongoose.Types.ObjectId;
  dateStr: string;
}): Promise<void> {
  if (opts.marriageId) {
    const once = await SharedGoal.find({
      marriageId: opts.marriageId,
      repeat: 'once',
    })
      .select('_id archived')
      .lean();
    if (!once.length) return;
    const ids = once.map((g) => g._id);
    const prior = await SharedGoalCompletion.find({
      marriageId: opts.marriageId,
      goalId: { $in: ids },
      checked: { $ne: false },
      dateStr: { $lt: opts.dateStr },
    })
      .select('goalId')
      .lean();
    const archiveIds = [...new Set(prior.map((c) => String(c.goalId)))];
    if (archiveIds.length) {
      await SharedGoal.updateMany(
        { _id: { $in: archiveIds }, marriageId: opts.marriageId, repeat: 'once', archived: false },
        { $set: { archived: true, enabled: false } },
      );
    }
    const todayDone = await SharedGoalCompletion.find({
      marriageId: opts.marriageId,
      goalId: { $in: ids },
      checked: { $ne: false },
      dateStr: opts.dateStr,
    })
      .select('goalId')
      .lean();
    const reviveIds = todayDone.map((c) => c.goalId);
    if (reviveIds.length) {
      await SharedGoal.updateMany(
        { _id: { $in: reviveIds }, marriageId: opts.marriageId, repeat: 'once', archived: true },
        { $set: { archived: false, enabled: true } },
      );
    }
    return;
  }

  if (!opts.userId) return;
  const once = await UserGoal.find({ userId: opts.userId, repeat: 'once' }).select('_id archived').lean();
  if (!once.length) return;
  const ids = once.map((g) => g._id);
  const prior = await GoalCompletion.find({
    userId: opts.userId,
    goalId: { $in: ids },
    checked: { $ne: false },
    dateStr: { $lt: opts.dateStr },
  })
    .select('goalId')
    .lean();
  const archiveIds = [...new Set(prior.map((c) => String(c.goalId)))];
  if (archiveIds.length) {
    await UserGoal.updateMany(
      { _id: { $in: archiveIds }, userId: opts.userId, repeat: 'once', archived: false },
      { $set: { archived: true, enabled: false } },
    );
  }
  const todayDone = await GoalCompletion.find({
    userId: opts.userId,
    goalId: { $in: ids },
    checked: { $ne: false },
    dateStr: opts.dateStr,
  })
    .select('goalId')
    .lean();
  const reviveIds = todayDone.map((c) => c.goalId);
  if (reviveIds.length) {
    await UserGoal.updateMany(
      { _id: { $in: reviveIds }, userId: opts.userId, repeat: 'once', archived: true },
      { $set: { archived: false, enabled: true } },
    );
  }
}

async function buildState(userId: string): Promise<GoalsTodayState> {
  const tz = await timezoneOf(userId);
  const dateStr = getTodayDateStr(tz);
  const weekday = localWeekday(tz);

  await settleOnceGoals({ userId, dateStr });

  const goals = await UserGoal.find({ userId, archived: false }).sort({ sortOrder: 1, createdAt: 1 });
  const completions = await GoalCompletion.find({ userId, dateStr }).lean();
  const completedIds = new Set(
    completions.filter((c) => c.checked !== false).map((c) => String(c.goalId)),
  );
  const publicGoals = goals.map((g) => toPublic(g, weekday, completedIds));

  const marriage = await findMarriageForUser(userId);
  const marriagePublic = marriage ? await getMarriagePublic(userId) : null;

  let sharedGoals: PublicGoal[] = [];
  if (marriage?.status === 'married') {
    await settleOnceGoals({ marriageId: marriage._id, dateStr });
    const rows = await SharedGoal.find({ marriageId: marriage._id, archived: false }).sort({
      sortOrder: 1,
      createdAt: 1,
    });
    const sharedDone = await SharedGoalCompletion.find({ marriageId: marriage._id, dateStr }).lean();
    const sharedDoneIds = new Set(
      sharedDone.filter((c) => c.checked !== false).map((c) => String(c.goalId)),
    );
    const completerIds = [
      ...new Set(sharedDone.map((c) => c.completedBy).filter(Boolean).map((id) => String(id))),
    ];
    const completers = completerIds.length
      ? await User.find({ _id: { $in: completerIds } }).select('username').lean()
      : [];
    const nameById = new Map(completers.map((u) => [String(u._id), u.username]));
    sharedGoals = rows.map((g) => {
      const id = String(g._id);
      const doneRow = sharedDone.find((c) => String(c.goalId) === id && c.checked !== false);
      return {
        id,
        source: 'shared' as const,
        title: g.title,
        ...(g.notes ? { notes: g.notes } : {}),
        iconItemType: g.iconItemType,
        rewardItemType: g.rewardItemType,
        repeat: g.repeat,
        repeatDays: g.repeatDays ?? [],
        ...(g.remindAt ? { remindAt: g.remindAt } : {}),
        ...(g.section ? { section: g.section } : {}),
        ...(g.sectionIconItemType ? { sectionIconItemType: g.sectionIconItemType } : {}),
        enabled: g.enabled,
        dueToday: isDueToday(g, weekday),
        completedToday: sharedDoneIds.has(id),
        ...(doneRow?.completedBy && nameById.get(String(doneRow.completedBy))
          ? { completedByUsername: nameById.get(String(doneRow.completedBy)) }
          : {}),
        sortOrder: g.sortOrder,
      };
    });
  }

  const iconArt = await loadIconArt([
    ...publicGoals.map((g) => g.iconItemType),
    ...publicGoals.map((g) => g.sectionIconItemType).filter((t): t is string => !!t),
    ...sharedGoals.map((g) => g.iconItemType),
    ...sharedGoals.map((g) => g.sectionIconItemType).filter((t): t is string => !!t),
    ...GOAL_CATALOG.map((e) => e.iconItemType),
    ...GOAL_ICON_PICKER,
    ...Object.values(DEFAULT_SECTION_ICONS),
  ]);

  const byCatalog = new Map(goals.filter((g) => g.catalogId).map((g) => [g.catalogId!, g]));
  const catalog = GOAL_CATALOG.map((e) =>
    withIconArt(
      {
        id: e.id,
        title: e.title,
        iconItemType: e.iconItemType,
        enabled: byCatalog.get(e.id)?.enabled ?? e.defaultEnabled,
      },
      iconArt,
    ),
  );

  const due = [
    ...publicGoals.filter((g) => g.dueToday),
    ...sharedGoals.filter((g) => g.dueToday),
  ];

  const rewardedCount = await rewardedTodayCount(userId, dateStr);

  return {
    dateStr,
    dueCount: due.length,
    completedCount: due.filter((g) => g.completedToday).length,
    rewardedCount,
    goals: publicGoals.map((g) => withIconArt(g, iconArt)),
    sharedGoals: sharedGoals.map((g) => withIconArt(g, iconArt)),
    marriage: marriagePublic,
    catalog,
    iconPicker: GOAL_ICON_PICKER,
    iconArt,
  };
}

export async function getGoalsToday(userId: string): Promise<GoalsTodayState> {
  await ensureCatalog(userId);
  return buildState(userId);
}

const HISTORY_MAX_DAYS = 400;

function dateStrInTz(date: Date, timezone?: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value ?? '';
    const m = parts.find((p) => p.type === 'month')?.value ?? '';
    const d = parts.find((p) => p.type === 'day')?.value ?? '';
    return `${y}-${m}-${d}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function weekdayOfDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function eachDateStr(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, m, d] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  while (y < ey || (y === ey && m < em) || (y === ey && m === em && d <= ed)) {
    out.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
  }
  return out;
}

function isScheduledOn(
  goal: { repeat: GoalRepeatKind; repeatDays?: number[] },
  weekday: number,
): boolean {
  if (goal.repeat === 'once' || goal.repeat === 'daily') return true;
  return Array.isArray(goal.repeatDays) && goal.repeatDays.includes(weekday);
}

type HistoryGoal = {
  id: string;
  createdDate: string;
  repeat: GoalRepeatKind;
  repeatDays: number[];
  projectSchedule: boolean;
  firstDone?: string;
};

function wasDueOnDay(goal: HistoryGoal, dateStr: string, weekday: number, completed: boolean): boolean {
  if (goal.createdDate > dateStr) return false;
  if (goal.repeat === 'once') {
    if (goal.firstDone && goal.firstDone < dateStr) return false;
    return goal.projectSchedule || completed;
  }
  if (!isScheduledOn(goal, weekday)) return false;
  return goal.projectSchedule || completed;
}

function firstDoneByGoal(
  rows: Array<{ goalId: unknown; dateStr: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const id = String(row.goalId);
    const prev = map.get(id);
    if (!prev || row.dateStr < prev) map.set(id, row.dateStr);
  }
  return map;
}

export async function getGoalHistory(
  userId: string,
  start: string,
  end: string,
): Promise<GoalHistoryState> {
  const tz = await timezoneOf(userId);
  const today = getTodayDateStr(tz);
  const clampedEnd = end > today ? today : end;
  if (start > clampedEnd) {
    throw new AppError('start must be <= end', 400, 'INVALID_RANGE');
  }
  const dates = eachDateStr(start, clampedEnd);
  if (dates.length > HISTORY_MAX_DAYS) {
    throw new AppError(`Range cannot exceed ${HISTORY_MAX_DAYS} days`, 400, 'RANGE_TOO_LARGE');
  }

  const [goals, completions, marriage] = await Promise.all([
    UserGoal.find({ userId }).select('repeat repeatDays enabled archived createdAt').lean(),
    GoalCompletion.find({
      userId,
      dateStr: { $gte: start, $lte: clampedEnd },
      checked: { $ne: false },
    })
      .select('goalId dateStr')
      .lean(),
    findMarriageForUser(userId),
  ]);

  const onceIds = goals.filter((g) => g.repeat === 'once').map((g) => g._id);
  const onceDone = onceIds.length
    ? await GoalCompletion.find({
        userId,
        goalId: { $in: onceIds },
        checked: { $ne: false },
      })
        .select('goalId dateStr')
        .lean()
    : [];
  const firstDone = firstDoneByGoal(onceDone);

  const historyGoals: HistoryGoal[] = goals.map((g) => ({
    id: String(g._id),
    createdDate: g.createdAt ? dateStrInTz(g.createdAt, tz) : start,
    repeat: g.repeat,
    repeatDays: g.repeatDays ?? [],
    projectSchedule: g.enabled && !g.archived,
    ...(firstDone.get(String(g._id)) ? { firstDone: firstDone.get(String(g._id)) } : {}),
  }));

  const completedByDay = new Map<string, Set<string>>();
  for (const row of completions) {
    const day = completedByDay.get(row.dateStr) ?? new Set<string>();
    day.add(String(row.goalId));
    completedByDay.set(row.dateStr, day);
  }

  if (marriage?.status === 'married') {
    const [sharedGoals, sharedDone] = await Promise.all([
      SharedGoal.find({ marriageId: marriage._id }).select('repeat repeatDays enabled archived createdAt').lean(),
      SharedGoalCompletion.find({
        marriageId: marriage._id,
        dateStr: { $gte: start, $lte: clampedEnd },
        checked: { $ne: false },
      })
        .select('goalId dateStr')
        .lean(),
    ]);
    const sharedOnceIds = sharedGoals.filter((g) => g.repeat === 'once').map((g) => g._id);
    const sharedOnceDone = sharedOnceIds.length
      ? await SharedGoalCompletion.find({
          marriageId: marriage._id,
          goalId: { $in: sharedOnceIds },
          checked: { $ne: false },
        })
          .select('goalId dateStr')
          .lean()
      : [];
    const sharedFirst = firstDoneByGoal(sharedOnceDone);
    for (const g of sharedGoals) {
      historyGoals.push({
        id: `shared:${String(g._id)}`,
        createdDate: g.createdAt ? dateStrInTz(g.createdAt, tz) : start,
        repeat: g.repeat,
        repeatDays: g.repeatDays ?? [],
        projectSchedule: g.enabled && !g.archived,
        ...(sharedFirst.get(String(g._id)) ? { firstDone: sharedFirst.get(String(g._id)) } : {}),
      });
    }
    for (const row of sharedDone) {
      const day = completedByDay.get(row.dateStr) ?? new Set<string>();
      day.add(`shared:${String(row.goalId)}`);
      completedByDay.set(row.dateStr, day);
    }
  }

  const days: GoalHistoryDay[] = dates.map((date) => {
    const weekday = weekdayOfDateStr(date);
    const done = completedByDay.get(date) ?? new Set<string>();
    let due = 0;
    let completed = 0;
    for (const goal of historyGoals) {
      const hit = done.has(goal.id);
      if (!wasDueOnDay(goal, date, weekday, hit)) continue;
      due += 1;
      if (hit) completed += 1;
    }
    return { date, due, completed };
  });

  let dueTotal = 0;
  let completedTotal = 0;
  let daysWithGoals = 0;
  let perfectDays = 0;
  let showUpDays = 0;
  let bestStreak = 0;
  let run = 0;

  for (const day of days) {
    dueTotal += day.due;
    completedTotal += day.completed;
    if (day.due > 0) daysWithGoals += 1;
    const perfect = day.due > 0 && day.completed >= day.due;
    if (perfect) perfectDays += 1;
    if (day.completed > 0) showUpDays += 1;
    if (day.due === 0) continue;
    if (perfect) {
      run += 1;
      if (run > bestStreak) bestStreak = run;
    } else {
      run = 0;
    }
  }

  let streak = 0;
  let i = days.length - 1;
  if (i >= 0 && days[i].due > 0 && days[i].completed < days[i].due) i -= 1;
  for (; i >= 0; i--) {
    const day = days[i];
    if (day.due === 0) continue;
    if (day.completed >= day.due) streak += 1;
    else break;
  }

  return {
    start,
    end: clampedEnd,
    days,
    due: dueTotal,
    completed: completedTotal,
    daysWithGoals,
    perfectDays,
    showUpDays,
    streak,
    bestStreak,
    rate: dueTotal > 0 ? completedTotal / dueTotal : 0,
  };
}

export async function createCustomGoal(
  userId: string,
  input: CreateCustomGoalInput,
): Promise<GoalsTodayState> {
  const title = input.title?.trim() ?? '';
  if (!title) throw new AppError('Title is required', 400, 'GOAL_TITLE_REQUIRED');
  if (title.length > TITLE_MAX) throw new AppError('Title is too long', 400, 'GOAL_TITLE_TOO_LONG');

  const iconItemType =
    input.iconItemType && GOAL_ICON_PICKER.includes(input.iconItemType)
      ? input.iconItemType
      : 'open_notebook';
  const repeat: GoalRepeatKind =
    input.repeat === 'weekdays' ? 'weekdays' : input.repeat === 'once' ? 'once' : 'daily';
  const repeatDays = repeat === 'weekdays' ? normalizeRepeatDays(input.repeatDays) : [];
  if (repeat === 'weekdays' && repeatDays.length === 0) {
    throw new AppError('Pick at least one day', 400, 'GOAL_DAYS_REQUIRED');
  }

  await ensureCustomGoalsNotBlockedByCatalogIndex();

  const section = normalizeSection(input.section);
  const sectionIconItemType = pickerIcon(input.sectionIconItemType) ?? defaultSectionIcon(section);
  const count = await UserGoal.countDocuments({ userId, archived: false });
  try {
    await UserGoal.create({
      userId,
      source: 'custom',
      title,
      notes: input.notes?.trim() || undefined,
      iconItemType,
      rewardItemType: GOAL_DEFAULT_REWARD_ITEM,
      repeat,
      repeatDays,
      remindAt: normalizeRemindAt(input.remindAt === undefined ? GOAL_CUSTOM_DEFAULT_REMIND_AT : input.remindAt),
      section,
      sectionIconItemType,
      enabled: true,
      archived: false,
      sortOrder: count,
    });
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 11000) {
      await ensureCustomGoalsNotBlockedByCatalogIndex();
      await UserGoal.create({
        userId,
        source: 'custom',
        title,
        notes: input.notes?.trim() || undefined,
        iconItemType,
        rewardItemType: GOAL_DEFAULT_REWARD_ITEM,
        repeat,
        repeatDays,
        remindAt: normalizeRemindAt(input.remindAt === undefined ? GOAL_CUSTOM_DEFAULT_REMIND_AT : input.remindAt),
        section,
        sectionIconItemType,
        enabled: true,
        archived: false,
        sortOrder: count,
      });
    } else {
      throw err;
    }
  }
  if (pickerIcon(input.sectionIconItemType)) {
    await syncSectionIcon({ userId, section, iconItemType: sectionIconItemType });
  }
  return buildState(userId);
}

export async function updateGoal(
  userId: string,
  goalId: string,
  input: UpdateGoalInput,
): Promise<GoalsTodayState> {
  if (!mongoose.isValidObjectId(goalId)) throw new AppError('Goal not found', 404, 'GOAL_NOT_FOUND');
  const goal = await UserGoal.findOne({ _id: goalId, userId, archived: false });
  if (!goal) throw new AppError('Goal not found', 404, 'GOAL_NOT_FOUND');

  if (input.title != null && goal.source === 'custom') {
    const title = input.title.trim();
    if (!title) throw new AppError('Title is required', 400, 'GOAL_TITLE_REQUIRED');
    if (title.length > TITLE_MAX) throw new AppError('Title is too long', 400, 'GOAL_TITLE_TOO_LONG');
    goal.title = title;
  }
  if (input.notes !== undefined && goal.source === 'custom') {
    goal.notes = input.notes?.trim() || undefined;
  }
  if (input.iconItemType && GOAL_ICON_PICKER.includes(input.iconItemType) && goal.source === 'custom') {
    goal.iconItemType = input.iconItemType;
  }
  if (input.repeat) {
    goal.repeat = input.repeat;
    goal.repeatDays = input.repeat === 'weekdays' ? normalizeRepeatDays(input.repeatDays ?? goal.repeatDays) : [];
    if (goal.repeat === 'weekdays' && goal.repeatDays.length === 0) {
      throw new AppError('Pick at least one day', 400, 'GOAL_DAYS_REQUIRED');
    }
  } else if (input.repeatDays && goal.repeat === 'weekdays') {
    goal.repeatDays = normalizeRepeatDays(input.repeatDays);
    if (goal.repeatDays.length === 0) throw new AppError('Pick at least one day', 400, 'GOAL_DAYS_REQUIRED');
  }
  const clearRemindAt = input.remindAt !== undefined && !normalizeRemindAt(input.remindAt);
  if (input.remindAt !== undefined) {
    const next = normalizeRemindAt(input.remindAt);
    if (next) goal.remindAt = next;
    else goal.set('remindAt', undefined);
  }
  if (typeof input.enabled === 'boolean') {
    goal.enabled = input.enabled;
  }
  if (input.section !== undefined) {
    const next = normalizeSection(input.section);
    if (next) goal.section = next;
    else goal.set('section', undefined);
  }

  await goal.save();
  if (clearRemindAt) {
    await UserGoal.updateOne({ _id: goal._id }, { $unset: { remindAt: 1 } });
  }
  if (input.section !== undefined && !goal.section) {
    await UserGoal.updateOne({ _id: goal._id }, { $unset: { section: 1 } });
  }
  if (input.sectionIconItemType !== undefined) {
    const section = goal.section || undefined;
    const icon = pickerIcon(input.sectionIconItemType) ?? defaultSectionIcon(section);
    await syncSectionIcon({ userId, section, iconItemType: icon });
  }
  return buildState(userId);
}

export async function archiveGoal(userId: string, goalId: string): Promise<GoalsTodayState> {
  if (!mongoose.isValidObjectId(goalId)) throw new AppError('Goal not found', 404, 'GOAL_NOT_FOUND');
  const goal = await UserGoal.findOne({ _id: goalId, userId, archived: false });
  if (!goal) throw new AppError('Goal not found', 404, 'GOAL_NOT_FOUND');
  if (goal.source === 'catalog') {
    goal.enabled = false;
    await goal.save();
    return buildState(userId);
  }
  goal.archived = true;
  goal.enabled = false;
  await goal.save();
  return buildState(userId);
}

const EMPTY_REWARD: GoalRewardPayload = { xpGained: 0, healthXp: 0, socialXp: 0 };

function isDupKey(err: unknown): boolean {
  return (err as { code?: number })?.code === 11000;
}

/** Give already-paid rows unique slots so new claims can't reuse them. */
async function occupyExistingRewardSlots(
  userId: string,
  dateStr: string,
): Promise<void> {
  const unpaidSlots = await GoalCompletion.find({
    userId,
    dateStr,
    rewarded: true,
    $or: [{ rewardSlot: { $exists: false } }, { rewardSlot: null }],
  })
    .sort({ createdAt: 1 })
    .select('_id')
    .lean();

  for (const row of unpaidSlots) {
    for (let slot = 0; slot < GOAL_MAX_REWARDED_PER_DAY; slot++) {
      try {
        await GoalCompletion.updateOne(
          {
            _id: row._id,
            $or: [{ rewardSlot: { $exists: false } }, { rewardSlot: null }],
          },
          { $set: { rewardSlot: slot } },
        );
        break;
      } catch (err: unknown) {
        if (!isDupKey(err)) throw err;
      }
    }
  }
}

async function tryClaimRewardSlot(completionId: mongoose.Types.ObjectId): Promise<boolean> {
  for (let slot = 0; slot < GOAL_MAX_REWARDED_PER_DAY; slot++) {
    try {
      const claimed = await GoalCompletion.findOneAndUpdate(
        { _id: completionId, rewarded: false },
        { $set: { rewarded: true, rewardSlot: slot } },
        { new: true },
      );
      if (claimed) return true;
    } catch (err: unknown) {
      if (!isDupKey(err)) throw err;
    }
  }
  return false;
}

async function grantGoalReward(userId: string): Promise<GoalRewardPayload> {
  await skillXpService.grantMany(userId, [
    { skill: 'health', amount: GOAL_HEALTH_XP },
    { skill: 'social', amount: GOAL_SOCIAL_XP },
  ]);
  const farm = await farmService.loadOrCreateFarm(userId);
  const item = await pickGoalRewardItem(userId, farm);
  grantLoot(farm, item.itemType, 1);
  await farm.save();
  return {
    xpGained: GOAL_HEALTH_XP + GOAL_SOCIAL_XP,
    healthXp: GOAL_HEALTH_XP,
    socialXp: GOAL_SOCIAL_XP,
    item,
  };
}

export async function completeGoal(
  userId: string,
  goalId: string,
): Promise<GoalsTodayState & { reward: GoalRewardPayload }> {
  if (!mongoose.isValidObjectId(goalId)) throw new AppError('Goal not found', 404, 'GOAL_NOT_FOUND');
  await ensureCompletionIndexes();
  const tz = await timezoneOf(userId);
  const dateStr = getTodayDateStr(tz);
  const weekday = localWeekday(tz);

  const goal = await UserGoal.findOne({ _id: goalId, userId, archived: false });
  if (!goal) throw new AppError('Goal not found', 404, 'GOAL_NOT_FOUND');
  if (!isDueToday(goal, weekday)) throw new AppError('This goal is not due today', 400, 'GOAL_NOT_DUE');

  const existing = await GoalCompletion.findOne({ userId, goalId: goal._id, dateStr });
  if (existing) {
    if (existing.checked === false) {
      existing.checked = true;
      await existing.save();
    }
    const state = await buildState(userId);
    return { ...state, reward: EMPTY_REWARD };
  }

  let created;
  try {
    created = await GoalCompletion.create({
      userId,
      goalId: goal._id,
      dateStr,
      checked: true,
      rewarded: false,
    });
  } catch (err: unknown) {
    if (!isDupKey(err)) throw err;
    const raced = await GoalCompletion.findOne({ userId, goalId: goal._id, dateStr });
    if (raced && raced.checked === false) {
      raced.checked = true;
      await raced.save();
    }
    const state = await buildState(userId);
    return { ...state, reward: EMPTY_REWARD };
  }

  await occupyExistingRewardSlots(userId, dateStr);
  const claimed = await tryClaimRewardSlot(created._id);
  if (!claimed) {
    log.info({ userId, goalId, rewarded: false }, 'Goal completed (daily reward cap)');
    const state = await buildState(userId);
    return { ...state, reward: EMPTY_REWARD };
  }

  let reward: GoalRewardPayload = EMPTY_REWARD;
  try {
    reward = await grantGoalReward(userId);
  } catch (err) {
    await GoalCompletion.updateOne(
      { _id: created._id },
      { $set: { rewarded: false }, $unset: { rewardSlot: 1 } },
    );
    throw err;
  }

  log.info({ userId, goalId, rewarded: true }, 'Goal completed');
  const state = await buildState(userId);
  return { ...state, reward };
}

export async function uncompleteGoal(userId: string, goalId: string): Promise<GoalsTodayState> {
  if (!mongoose.isValidObjectId(goalId)) throw new AppError('Goal not found', 404, 'GOAL_NOT_FOUND');
  const tz = await timezoneOf(userId);
  const dateStr = getTodayDateStr(tz);
  await GoalCompletion.updateOne(
    { userId, goalId, dateStr },
    { $set: { checked: false } },
  );
  const goal = await UserGoal.findOne({ _id: goalId, userId });
  if (goal?.repeat === 'once' && goal.archived) {
    goal.archived = false;
    goal.enabled = true;
    await goal.save();
  }
  return buildState(userId);
}

/**
 * Reminders at remindAt in the user's timezone. Idempotent via lastRemindedDateStr.
 */
export async function notifyDueGoalReminders(): Promise<void> {
  const due = await UserGoal.find({
    enabled: true,
    archived: false,
    remindAt: { $exists: true, $nin: [null, ''] },
  }).limit(400);

  if (!due.length) return;

  const userIds = [...new Set(due.map((g) => String(g.userId)))];
  const users = await User.find({ _id: { $in: userIds } }).select('timezone').lean();
  const tzByUser = new Map(users.map((u) => [String(u._id), u.timezone]));

  let sent = 0;
  for (const goal of due) {
    const userId = String(goal.userId);
    const tz = tzByUser.get(userId);
    const dateStr = getTodayDateStr(tz);
    if (goal.lastRemindedDateStr === dateStr) continue;
    if (!isDueToday(goal, localWeekday(tz))) continue;
    if (localTimeHm(tz) < (goal.remindAt ?? '99:99')) continue;

    const done = await GoalCompletion.exists({
      userId: goal.userId,
      goalId: goal._id,
      dateStr,
      checked: { $ne: false },
    });
    if (done) {
      goal.lastRemindedDateStr = dateStr;
      await goal.save();
      continue;
    }

    const claimed = await UserGoal.updateOne(
      { _id: goal._id, lastRemindedDateStr: { $ne: dateStr } },
      { $set: { lastRemindedDateStr: dateStr } },
    );
    if (claimed.modifiedCount === 0) continue;

    await notificationService.createAndDeliver(userId, 'goal_reminder', {
      goalId: String(goal._id),
      goalTitle: goal.title,
    });
    sent += 1;
  }

  sent += await notifySharedGoalReminders();

  if (sent > 0) log.info({ sent }, 'Goal reminders delivered');
}

async function notifySharedGoalReminders(): Promise<number> {
  const due = await SharedGoal.find({
    enabled: true,
    archived: false,
    remindAt: { $exists: true, $nin: [null, ''] },
  }).limit(200);
  if (!due.length) return 0;

  const marriageIds = [...new Set(due.map((g) => String(g.marriageId)))];
  const marriages = await Marriage.find({ _id: { $in: marriageIds } });
  const marriageById = new Map(marriages.map((m) => [String(m._id), m]));

  const spouseIds = [
    ...new Set(
      marriages.flatMap((m) => [String(m.userLow), String(m.userHigh)]),
    ),
  ];
  const users = spouseIds.length
    ? await User.find({ _id: { $in: spouseIds } }).select('timezone').lean()
    : [];
  const tzByUser = new Map(users.map((u) => [String(u._id), u.timezone]));

  let sent = 0;
  for (const goal of due) {
    const marriage = marriageById.get(String(goal.marriageId));
    if (!marriage || marriage.status !== 'married') continue;
    const spouses = [String(marriage.userLow), String(marriage.userHigh)];
    for (const userId of spouses) {
      const tz = tzByUser.get(userId);
      const dateStr = getTodayDateStr(tz);
      if (goal.lastRemindedDateStr === dateStr) continue;
      if (!isDueToday(goal, localWeekday(tz))) continue;
      if (localTimeHm(tz) < (goal.remindAt ?? '99:99')) continue;
      const done = await SharedGoalCompletion.exists({
        marriageId: goal.marriageId,
        goalId: goal._id,
        dateStr,
        checked: { $ne: false },
      });
      if (done) continue;
      await notificationService.createAndDeliver(userId, 'goal_reminder', {
        goalId: String(goal._id),
        goalTitle: goal.title,
      });
      sent += 1;
    }
    const anyTz = tzByUser.get(String(marriage.userLow));
    goal.lastRemindedDateStr = getTodayDateStr(anyTz);
    await goal.save();
  }
  return sent;
}

function parseRepeat(input?: GoalRepeatKind, days?: number[]): { repeat: GoalRepeatKind; repeatDays: number[] } {
  const repeat: GoalRepeatKind =
    input === 'weekdays' ? 'weekdays' : input === 'once' ? 'once' : 'daily';
  const repeatDays = repeat === 'weekdays' ? normalizeRepeatDays(days) : [];
  if (repeat === 'weekdays' && repeatDays.length === 0) {
    throw new AppError('Pick at least one day', 400, 'GOAL_DAYS_REQUIRED');
  }
  return { repeat, repeatDays };
}

async function rewardedTodayCount(userId: string, dateStr: string): Promise<number> {
  const [personal, sharedAsCompleter, sharedAsPartner] = await Promise.all([
    GoalCompletion.countDocuments({ userId, dateStr, rewarded: true }),
    SharedGoalCompletion.countDocuments({ completedBy: userId, dateStr, rewarded: true }),
    SharedGoalCompletion.countDocuments({
      partnerId: userId,
      partnerRewardDateStr: dateStr,
      partnerRewarded: true,
    }),
  ]);
  return personal + sharedAsCompleter + sharedAsPartner;
}

async function notifyPartnerSharedGoal(
  marriage: { userLow: mongoose.Types.ObjectId; userHigh: mongoose.Types.ObjectId },
  userId: string,
  type: 'shared_goal_complete' | 'shared_goal_added',
  goal: { _id: mongoose.Types.ObjectId; title: string },
  partnerReward?: GoalRewardPayload,
): Promise<void> {
  const partnerId = otherSpouse(marriage, userId);
  const from = await User.findById(userId).select('username').lean();
  await notificationService.createAndDeliver(partnerId, type, {
    fromUserId: userId,
    fromUsername: from?.username,
    goalId: String(goal._id),
    goalTitle: goal.title,
    ...(partnerReward?.item
      ? {
          rewardItemType: partnerReward.item.itemType,
          rewardItemLabel: partnerReward.item.label,
          ...(partnerReward.item.imageUrl ? { rewardImageUrl: partnerReward.item.imageUrl } : {}),
          ...(partnerReward.item.emoji ? { rewardEmoji: partnerReward.item.emoji } : {}),
          rewardQty: partnerReward.item.qty,
          xpGained: partnerReward.xpGained,
        }
      : {}),
  });
}

export async function proposeGoalMarriage(userId: string, toUserId: string): Promise<GoalsTodayState> {
  const marriage = await proposeMarriage(userId, toUserId);
  const from = await User.findById(userId).select('username').lean();
  await notificationService.createAndDeliver(toUserId, 'marriage_proposal', {
    fromUserId: userId,
    marriageId: marriage.id,
    fromUsername: from?.username,
  });
  return buildState(userId);
}

export async function respondToGoalMarriage(
  userId: string,
  marriageId: string,
  status: 'accepted' | 'rejected',
): Promise<GoalsTodayState> {
  const result = await respondToMarriage(userId, marriageId, status);
  if (status === 'accepted' && result) {
    await notificationService.createAndDeliver(result.partner.id, 'marriage_accepted', {
      fromUserId: userId,
      marriageId,
      fromUsername: (await User.findById(userId).select('username').lean())?.username,
    });
  }
  return buildState(userId);
}

export async function endGoalMarriage(userId: string): Promise<GoalsTodayState> {
  await endMarriage(userId);
  return buildState(userId);
}

export async function createSharedGoal(
  userId: string,
  input: CreateCustomGoalInput,
): Promise<GoalsTodayState> {
  const marriage = await requireMarried(userId);
  const title = input.title?.trim() ?? '';
  if (!title) throw new AppError('Title is required', 400, 'GOAL_TITLE_REQUIRED');
  if (title.length > TITLE_MAX) throw new AppError('Title is too long', 400, 'GOAL_TITLE_TOO_LONG');
  const iconItemType =
    input.iconItemType && GOAL_ICON_PICKER.includes(input.iconItemType)
      ? input.iconItemType
      : 'open_notebook';
  const { repeat, repeatDays } = parseRepeat(input.repeat, input.repeatDays);
  const section = normalizeSection(input.section);
  const sectionIconItemType = pickerIcon(input.sectionIconItemType) ?? defaultSectionIcon(section);
  const count = await SharedGoal.countDocuments({ marriageId: marriage._id, archived: false });
  await SharedGoal.create({
    marriageId: marriage._id,
    createdBy: userId,
    title,
    notes: input.notes?.trim() || undefined,
    iconItemType,
    rewardItemType: GOAL_DEFAULT_REWARD_ITEM,
    repeat,
    repeatDays,
    remindAt: normalizeRemindAt(input.remindAt === undefined ? GOAL_CUSTOM_DEFAULT_REMIND_AT : input.remindAt),
    section,
    sectionIconItemType,
    enabled: true,
    archived: false,
    sortOrder: count,
  });
  if (pickerIcon(input.sectionIconItemType)) {
    await syncSectionIcon({ marriageId: marriage._id, section, iconItemType: sectionIconItemType });
  }
  return buildState(userId);
}

export async function shareCustomGoal(
  userId: string,
  goalId: string,
  input: UpdateGoalInput = {},
): Promise<GoalsTodayState> {
  const marriage = await requireMarried(userId);
  if (!mongoose.isValidObjectId(goalId)) throw new AppError('Goal not found', 404, 'GOAL_NOT_FOUND');
  const goal = await UserGoal.findOne({ _id: goalId, userId, archived: false });
  if (!goal) throw new AppError('Goal not found', 404, 'GOAL_NOT_FOUND');
  if (goal.source !== 'custom') {
    throw new AppError('Only custom goals can be shared', 400, 'GOAL_NOT_CUSTOM');
  }

  const title = (input.title ?? goal.title).trim();
  if (!title) throw new AppError('Title is required', 400, 'GOAL_TITLE_REQUIRED');
  if (title.length > TITLE_MAX) throw new AppError('Title is too long', 400, 'GOAL_TITLE_TOO_LONG');

  const iconItemType =
    input.iconItemType && GOAL_ICON_PICKER.includes(input.iconItemType)
      ? input.iconItemType
      : goal.iconItemType;
  const { repeat, repeatDays } = parseRepeat(input.repeat ?? goal.repeat, input.repeatDays ?? goal.repeatDays);
  const notes =
    input.notes !== undefined ? input.notes?.trim() || undefined : goal.notes || undefined;
  const remindAt =
    input.remindAt !== undefined
      ? normalizeRemindAt(input.remindAt)
      : goal.remindAt;
  const section =
    input.section !== undefined ? normalizeSection(input.section) : goal.section || undefined;
  const sectionIconItemType =
    pickerIcon(input.sectionIconItemType) ?? goal.sectionIconItemType ?? defaultSectionIcon(section);

  const count = await SharedGoal.countDocuments({ marriageId: marriage._id, archived: false });
  const shared = await SharedGoal.create({
    marriageId: marriage._id,
    createdBy: userId,
    title,
    notes,
    iconItemType,
    rewardItemType: goal.rewardItemType || GOAL_DEFAULT_REWARD_ITEM,
    repeat,
    repeatDays,
    remindAt,
    section,
    sectionIconItemType,
    enabled: true,
    archived: false,
    sortOrder: count,
  });

  const tz = await timezoneOf(userId);
  const dateStr = getTodayDateStr(tz);
  const personalDone = await GoalCompletion.findOne({
    userId,
    goalId: goal._id,
    dateStr,
    checked: { $ne: false },
  }).lean();
  if (personalDone) {
    await SharedGoalCompletion.create({
      marriageId: marriage._id,
      goalId: shared._id,
      dateStr,
      checked: true,
      completedBy: userId,
      rewarded: false,
    });
  }

  goal.archived = true;
  goal.enabled = false;
  await goal.save();

  await notifyPartnerSharedGoal(marriage, userId, 'shared_goal_added', shared);
  return buildState(userId);
}

export async function updateSharedGoal(
  userId: string,
  goalId: string,
  input: UpdateGoalInput,
): Promise<GoalsTodayState> {
  const marriage = await requireMarried(userId);
  if (!mongoose.isValidObjectId(goalId)) throw new AppError('Goal not found', 404, 'GOAL_NOT_FOUND');
  const goal = await SharedGoal.findOne({ _id: goalId, marriageId: marriage._id, archived: false });
  if (!goal) throw new AppError('Goal not found', 404, 'GOAL_NOT_FOUND');
  if (input.title != null) {
    const title = input.title.trim();
    if (!title) throw new AppError('Title is required', 400, 'GOAL_TITLE_REQUIRED');
    goal.title = title;
  }
  if (input.notes !== undefined) goal.notes = input.notes?.trim() || undefined;
  if (input.iconItemType && GOAL_ICON_PICKER.includes(input.iconItemType)) {
    goal.iconItemType = input.iconItemType;
  }
  if (input.repeat) {
    const parsed = parseRepeat(input.repeat, input.repeatDays ?? goal.repeatDays);
    goal.repeat = parsed.repeat;
    goal.repeatDays = parsed.repeatDays;
  }
  const clearRemindAt = input.remindAt !== undefined && !normalizeRemindAt(input.remindAt);
  if (input.remindAt !== undefined) {
    const next = normalizeRemindAt(input.remindAt);
    if (next) goal.remindAt = next;
    else goal.set('remindAt', undefined);
  }
  if (typeof input.enabled === 'boolean') goal.enabled = input.enabled;
  if (input.section !== undefined) {
    const next = normalizeSection(input.section);
    if (next) goal.section = next;
    else goal.set('section', undefined);
  }
  await goal.save();
  if (clearRemindAt) {
    await SharedGoal.updateOne({ _id: goal._id }, { $unset: { remindAt: 1 } });
  }
  if (input.section !== undefined && !goal.section) {
    await SharedGoal.updateOne({ _id: goal._id }, { $unset: { section: 1 } });
  }
  if (input.sectionIconItemType !== undefined) {
    const section = goal.section || undefined;
    const icon = pickerIcon(input.sectionIconItemType) ?? defaultSectionIcon(section);
    await syncSectionIcon({ marriageId: marriage._id, section, iconItemType: icon });
  }
  return buildState(userId);
}

export async function archiveSharedGoal(userId: string, goalId: string): Promise<GoalsTodayState> {
  const marriage = await requireMarried(userId);
  if (!mongoose.isValidObjectId(goalId)) throw new AppError('Goal not found', 404, 'GOAL_NOT_FOUND');
  const goal = await SharedGoal.findOne({ _id: goalId, marriageId: marriage._id, archived: false });
  if (!goal) throw new AppError('Goal not found', 404, 'GOAL_NOT_FOUND');
  goal.archived = true;
  goal.enabled = false;
  await goal.save();
  return buildState(userId);
}

export async function completeSharedGoal(
  userId: string,
  goalId: string,
): Promise<GoalsTodayState & { reward: GoalRewardPayload }> {
  const marriage = await requireMarried(userId);
  if (!mongoose.isValidObjectId(goalId)) throw new AppError('Goal not found', 404, 'GOAL_NOT_FOUND');
  const tz = await timezoneOf(userId);
  const dateStr = getTodayDateStr(tz);
  const weekday = localWeekday(tz);
  const goal = await SharedGoal.findOne({ _id: goalId, marriageId: marriage._id, archived: false });
  if (!goal) throw new AppError('Goal not found', 404, 'GOAL_NOT_FOUND');
  if (!isDueToday(goal, weekday)) throw new AppError('This goal is not due today', 400, 'GOAL_NOT_DUE');

  const existing = await SharedGoalCompletion.findOne({
    marriageId: marriage._id,
    goalId: goal._id,
    dateStr,
  });
  if (existing) {
    const newlyChecked = existing.checked === false;
    if (newlyChecked) {
      existing.checked = true;
      existing.completedBy = new mongoose.Types.ObjectId(userId);
      await existing.save();
    }
    if (newlyChecked) {
      await notifyPartnerSharedGoal(marriage, userId, 'shared_goal_complete', goal);
    }
    return { ...(await buildState(userId)), reward: EMPTY_REWARD };
  }

  const created = await SharedGoalCompletion.create({
    marriageId: marriage._id,
    goalId: goal._id,
    dateStr,
    checked: true,
    completedBy: userId,
    rewarded: false,
    partnerRewarded: false,
  });

  let reward: GoalRewardPayload = EMPTY_REWARD;
  if ((await rewardedTodayCount(userId, dateStr)) < GOAL_MAX_REWARDED_PER_DAY) {
    try {
      reward = await grantGoalReward(userId);
      created.rewarded = true;
    } catch (err) {
      await SharedGoalCompletion.deleteOne({ _id: created._id });
      throw err;
    }
  }

  const partnerId = otherSpouse(marriage, userId);
  let partnerReward: GoalRewardPayload = EMPTY_REWARD;
  try {
    const partnerDateStr = getTodayDateStr(await timezoneOf(partnerId));
    if ((await rewardedTodayCount(partnerId, partnerDateStr)) < GOAL_MAX_REWARDED_PER_DAY) {
      partnerReward = await grantGoalReward(partnerId);
      created.partnerId = new mongoose.Types.ObjectId(partnerId);
      created.partnerRewarded = true;
      created.partnerRewardDateStr = partnerDateStr;
    }
  } catch (err) {
    log.warn({ err, partnerId, goalId }, 'Partner shared-goal reward failed');
  }
  await created.save();

  await notifyPartnerSharedGoal(marriage, userId, 'shared_goal_complete', goal, partnerReward);
  return { ...(await buildState(userId)), reward };
}

export async function uncompleteSharedGoal(userId: string, goalId: string): Promise<GoalsTodayState> {
  const marriage = await requireMarried(userId);
  if (!mongoose.isValidObjectId(goalId)) throw new AppError('Goal not found', 404, 'GOAL_NOT_FOUND');
  const tz = await timezoneOf(userId);
  const dateStr = getTodayDateStr(tz);
  await SharedGoalCompletion.updateOne(
    { marriageId: marriage._id, goalId, dateStr },
    { $set: { checked: false } },
  );
  const goal = await SharedGoal.findOne({ _id: goalId, marriageId: marriage._id });
  if (goal?.repeat === 'once' && goal.archived) {
    goal.archived = false;
    goal.enabled = true;
    await goal.save();
  }
  return buildState(userId);
}
