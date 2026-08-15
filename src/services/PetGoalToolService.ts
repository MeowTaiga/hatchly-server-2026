import type { GoalRepeatKind } from '../models/UserGoal.js';
import { AppError } from '../middleware/errorHandler.js';
import { createLogger } from '../config/logger.js';
import {
  GOAL_CATALOG,
  GOAL_ICON_PICKER,
  catalogEntryById,
  matchCatalogEntry,
  pickGoalIconFromTitle,
} from '../constants/goalCatalog.js';
import {
  createCustomGoal,
  getGoalsToday,
  publicGoalToChatCardGoal,
  updateGoal,
  type ChatGoalCard,
  type PublicGoal,
} from './GoalService.js';

const log = createLogger('PetGoalToolService');

export interface GoalToolBag {
  cards: ChatGoalCard[];
  createdThisTurn?: boolean;
}

export interface CreateGoalArgs {
  title: string;
  notes?: string;
  fromText?: string;
  repeat?: GoalRepeatKind;
  repeatDays?: number[];
  remindAt?: string;
  iconItemType?: string;
}

interface ToggleCatalogArgs {
  catalogId?: string;
  title?: string;
  enabled: boolean;
}

interface OfferCompleteArgs {
  goalId?: string;
  query?: string;
}

function errMsg(err: unknown): string {
  if (err instanceof AppError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

function pushCard(bag: GoalToolBag, card: ChatGoalCard): void {
  bag.cards = bag.cards.filter((c) => !(c.kind === card.kind && c.goal.id === card.goal.id));
  bag.cards.push(card);
}

function inferScheduleFromTitle(
  title: string,
  repeat?: GoalRepeatKind,
  repeatDays?: number[],
): { repeat: GoalRepeatKind; repeatDays: number[] } {
  if (repeat === 'once') {
    return { repeat: 'once', repeatDays: [] };
  }
  if (repeat === 'weekdays' && (repeatDays?.length ?? 0) > 0) {
    return { repeat: 'weekdays', repeatDays: repeatDays ?? [] };
  }
  if ((repeatDays?.length ?? 0) > 0) {
    return { repeat: 'weekdays', repeatDays: repeatDays ?? [] };
  }

  const t = title.toLowerCase();
  const days: number[] = [];
  const named: Array<[RegExp, number]> = [
    [/\bsundays?\b|\bsuns?\b/, 0],
    [/\bmondays?\b|\bmons?\b/, 1],
    [/\btuesdays?\b|\btues?\b/, 2],
    [/\bwednesdays?\b|\bweds?\b/, 3],
    [/\bthursdays?\b|\bthurs?\b/, 4],
    [/\bfridays?\b|\bfris?\b/, 5],
    [/\bsaturdays?\b|\bsats?\b/, 6],
  ];
  for (const [re, d] of named) {
    if (re.test(t)) days.push(d);
  }
  if (/\bweekends?\b/.test(t)) {
    days.push(0, 6);
  }
  if (/\bweekdays?\b/.test(t)) {
    days.push(1, 2, 3, 4, 5);
  }
  const uniq = [...new Set(days)].sort((a, b) => a - b);
  if (uniq.length) return { repeat: 'weekdays', repeatDays: uniq };
  if (/\b(one[- ]?time|just once|only once|doesn'?t repeat|non[- ]?recurring)\b/.test(t)) {
    return { repeat: 'once', repeatDays: [] };
  }
  return { repeat: 'daily', repeatDays: [] };
}

function findCustomByTitle(goals: PublicGoal[], title: string): PublicGoal | undefined {
  const needle = title.trim().toLowerCase();
  return goals.find((g) => g.source === 'custom' && g.title.trim().toLowerCase() === needle);
}

const COMPLETION_RE =
  /\b(i (just )?did|i finished|check(ed)? off|completed|mark(ed)? (it|that)? ?done|already did)\b/i;
const GOAL_QUERY_RE = /\b(what are|show( me)?|list|how many)\b.*\bgoals?\b/i;
const WANT_RE =
  /\b(wanna|want to|gonna|going to|need to|gotta|remind me|i should|please add|can you (add|make|create|set).{0,24}\bgoal|could you (add|make|create|set).{0,24}\bgoal|(add|create|set|make)(\s+me)?(\s+a)?(\s+new)?\s+goal|goal\s+to)\b/i;
const DAY_RE =
  /\b((every|each|on)\s+)?(sun(day)?s?|mon(day)?s?|tue(s(day)?s?)?|wed(nesday)?s?|thu(r(s(day)?s?)?)?|fri(day)?s?|sat(urday)?s?|weekdays?|weekends?|every day|daily)\b/i;

const TITLE_MAX_WORDS = 6;
const TITLE_MAX_CHARS = 40;

/** "make me a goal to X" / "add a goal called X" — capture the habit, not the request. */
const GOAL_HABIT_LEAD_RE =
  /\b(?:make|add|create|set|start)\s+(?:me\s+)?(?:a\s+)?(?:new\s+)?goal\s+(?:to|for|called|named)\s+/i;
const WANT_GOAL_LEAD_RE =
  /\b(?:want|wanna|need|gonna|going to)\s+(?:a\s+)?(?:new\s+)?goal\s+(?:to|for|called|named)\s+/i;
const BARE_GOAL_LEAD_RE = /\b(?:a\s+)?(?:new\s+)?goal\s+(?:to|for|called|named)\s+/i;

const BAD_TITLE_RE =
  /^(hey|hi|hello|yo|please|thanks|thank you|ok|okay|yes|yeah|goal|a goal|new goal|a new goal|make me|make me a goal|can you|could you)$/i;

function takeHabitAfterLead(text: string, lead: RegExp): string | null {
  const match = lead.exec(text);
  if (!match || match.index == null) return null;
  const rest = text.slice(match.index + match[0].length).trim();
  return rest || null;
}

function stripSchedulePhrases(text: string): string {
  let t = text;
  t = t.replace(
    /\b(every|each|on)\s+(sun(day)?s?|mon(day)?s?|tue(s(day)?s?)?|wed(nesday)?s?|thu(r(s(day)?s?)?)?|fri(day)?s?|sat(urday)?s?)\b/gi,
    '',
  );
  t = t.replace(
    /\b(sundays?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|weekdays?|weekends?|every day|daily|each day)\b/gi,
    '',
  );
  t = t.replace(/\b(at\s+\d{1,2}(:\d{2})?\s*(am|pm)?)\b/gi, '');
  t = t.replace(
    /\b((every|each|in the)\s+(morning|afternoon|evening|night)|after work|before bed)\b/gi,
    '',
  );
  t = t.replace(/\b(please|thanks|thank you|real quick|really)\b/gi, '');
  return t;
}

function finalizeTitle(text: string): string {
  let t = stripSchedulePhrases(text);
  t = t.replace(/[.!?,;:]+/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/^(to|for|and|the)\s+/i, '');
  t = t.replace(/\s+(to|for|and)$/i, '');

  const words = t.split(' ').filter(Boolean).slice(0, TITLE_MAX_WORDS);
  let title = words.join(' ');
  if (title.length > TITLE_MAX_CHARS) {
    title = title.slice(0, TITLE_MAX_CHARS).replace(/\s+\S*$/, '').trim();
  }
  if (title.length < 3 || BAD_TITLE_RE.test(title)) return '';
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/** Pull a short habit name out of a chat line. Empty if nothing usable remains. */
export function extractGoalTitle(raw: string): string {
  let t = (raw ?? '').trim();
  if (!t) return '';

  // Greetings often come with "Hey!" — splitting on punctuation first left title "Hey".
  t = t.replace(/^(hey|hi|hello|yo|please|thanks|thank you)[.!?,:\s]+/i, '');
  t = t.split(/\b(because|so that|since|and then)\b/i)[0] ?? t;

  const afterLead =
    takeHabitAfterLead(t, GOAL_HABIT_LEAD_RE) ??
    takeHabitAfterLead(t, WANT_GOAL_LEAD_RE) ??
    takeHabitAfterLead(t, BARE_GOAL_LEAD_RE);
  if (afterLead) t = afterLead;

  t = (t.split(/[.!?]/)[0] ?? t).trim();

  let prev = '';
  while (t !== prev) {
    prev = t;
    t = t.replace(/^(hey|hi|hello|yo|please|thanks|thank you)[.!?,:\s]+/i, '');
    t = t.replace(/^(can you|could you|will you|would you)\s+/i, '');
    t = t.replace(
      /^(i(?:'m| am|'ve| have)?\s+)?(wanna|want to|wanted to|gonna|going to|need to|needed to|gotta|have to|should)\s+/i,
      '',
    );
    t = t.replace(/^(remind me to|help me(?: to)?|let'?s)\s+/i, '');
    t = t.replace(/^(add|create|set|make)\s+(me\s+)?(a\s+)?(new\s+)?goal\s+(to|for|called|named)?\s*/i, '');
    t = t.replace(/^(a\s+)?(new\s+)?goal\s+(to|for)\s+/i, '');
    t = t.replace(/^(to\s+)?(start|begin)\s+/i, '');
    t = t.replace(/\s+for me\b/gi, ' ');
  }

  return finalizeTitle(t);
}

function pickCreateTitle(args: CreateGoalArgs, userMessage?: string): string {
  const utterance = (args.fromText || userMessage || '').trim();
  return extractGoalTitle(utterance) || extractGoalTitle(args.title ?? '');
}

function inferGoalNotes(raw: string, title: string): string | undefined {
  const because = raw.match(/\b(?:because|so that|since)\s+(.+)$/i);
  if (because?.[1]) {
    const n = because[1].replace(/[.!?]+$/g, '').trim();
    if (n.length >= 4) return n.charAt(0).toUpperCase() + n.slice(1, 240);
  }
  const when = raw.match(/\b(after work|before bed|in the (?:morning|afternoon|evening|night))\b/i);
  if (when?.[0] && !title.toLowerCase().includes(when[0].toLowerCase())) {
    return when[0].charAt(0).toUpperCase() + when[0].slice(1);
  }
  return undefined;
}

/** Parse a chat line into a custom goal. Returns null for check-offs, queries, or exact premade names with no extra detail. */
export function inferCustomGoalFromUtterance(text: string): CreateGoalArgs | null {
  const raw = text.trim();
  if (raw.length < 4 || raw.length > 240) return null;
  if (COMPLETION_RE.test(raw) || GOAL_QUERY_RE.test(raw)) return null;

  const wants = WANT_RE.test(raw);
  const hasDay = DAY_RE.test(raw);
  if (!wants && !hasDay) return null;

  const title = extractGoalTitle(raw);
  if (!title) return null;

  const catalogHit = matchCatalogEntry(title);
  if (catalogHit && !hasDay && title.trim().toLowerCase() === catalogHit.title.toLowerCase()) {
    return null;
  }

  return { title, fromText: raw, notes: inferGoalNotes(raw, title) };
}

export async function autoCreateCustomGoalFromChat(
  userId: string,
  userMessage: string,
  bag: GoalToolBag,
): Promise<ChatGoalCard | null> {
  if (bag.cards.some((c) => c.kind === 'created')) return null;
  const inferred = inferCustomGoalFromUtterance(userMessage);
  if (!inferred) return null;
  await handleCreateGoal(userId, bag, inferred);
  return bag.cards.find((c) => c.kind === 'created') ?? null;
}

function scoreMatch(goal: PublicGoal, query: string): number {
  const q = query.trim().toLowerCase();
  const title = goal.title.toLowerCase();
  if (goal.id === query) return 100;
  if (title === q) return 90;
  if (title.includes(q) || q.includes(title)) return 70;
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  const hits = words.filter((w) => title.includes(w)).length;
  return hits * 15;
}

async function handleCreateGoal(
  userId: string,
  bag: GoalToolBag,
  args: CreateGoalArgs,
  userMessage?: string,
): Promise<string> {
  if (bag.createdThisTurn) {
    const existing = bag.cards.find((c) => c.kind === 'created');
    if (existing) {
      return JSON.stringify({ ok: true, alreadyExisted: true, goal: existing.goal });
    }
    return JSON.stringify({ ok: true, alreadyExisted: true });
  }

  const title = pickCreateTitle(args, userMessage);
  if (!title) return JSON.stringify({ error: 'Title is required' });

  const { repeat, repeatDays } = inferScheduleFromTitle(
    [args.fromText, userMessage, args.title, args.notes].filter(Boolean).join(' '),
    args.repeat,
    args.repeatDays,
  );
  const iconItemType =
    args.iconItemType && GOAL_ICON_PICKER.includes(args.iconItemType)
      ? args.iconItemType
      : pickGoalIconFromTitle(title);

  try {
    const state = await getGoalsToday(userId);
    const dup = findCustomByTitle(state.goals, title);
    if (dup) {
      bag.createdThisTurn = true;
      pushCard(bag, {
        kind: 'created',
        alreadyExisted: true,
        goal: publicGoalToChatCardGoal(dup),
      });
      return JSON.stringify({ ok: true, alreadyExisted: true, goal: publicGoalToChatCardGoal(dup) });
    }

    const notes =
      args.notes?.trim() ||
      inferGoalNotes(args.fromText || userMessage || '', title) ||
      undefined;

    const next = await createCustomGoal(userId, {
      title,
      notes,
      iconItemType,
      repeat,
      repeatDays,
      remindAt: args.remindAt || undefined,
    });
    const created =
      findCustomByTitle(next.goals, title) ??
      next.goals.filter((g) => g.source === 'custom').slice(-1)[0];
    if (!created) return JSON.stringify({ error: 'Created but could not load the goal' });

    bag.createdThisTurn = true;
    pushCard(bag, { kind: 'created', goal: publicGoalToChatCardGoal(created) });
    log.info({ userId, goalId: created.id, title: created.title }, 'Chat created custom goal');
    return JSON.stringify({ ok: true, alreadyExisted: false, goal: publicGoalToChatCardGoal(created) });
  } catch (err) {
    log.warn({ err, userId, title }, 'Chat create_goal failed');
    return JSON.stringify({ error: errMsg(err) });
  }
}

async function handleToggleCatalog(
  userId: string,
  bag: GoalToolBag,
  args: ToggleCatalogArgs,
): Promise<string> {
  const entry =
    (args.catalogId ? catalogEntryById(args.catalogId) : undefined) ??
    (args.title ? matchCatalogEntry(args.title) : undefined);
  if (!entry) {
    return JSON.stringify({
      error: 'Unknown premade goal. Use a catalog id, or create_goal for a custom habit.',
    });
  }
  if (typeof args.enabled !== 'boolean') {
    return JSON.stringify({ error: 'enabled must be true or false' });
  }

  try {
    const state = await getGoalsToday(userId);
    const existing = state.goals.find((g) => g.catalogId === entry.id);
    if (!existing) {
      return JSON.stringify({ error: `Premade goal ${entry.id} is missing` });
    }
    const next = existing.enabled === args.enabled
      ? state
      : await updateGoal(userId, existing.id, { enabled: args.enabled });
    const goal = next.goals.find((g) => g.catalogId === entry.id);
    if (!goal) return JSON.stringify({ error: 'Could not load premade goal' });

    pushCard(bag, {
      kind: 'created',
      alreadyExisted: existing.enabled === args.enabled,
      goal: publicGoalToChatCardGoal(goal),
    });
    log.info({ userId, catalogId: entry.id, enabled: args.enabled }, 'Chat toggled catalog goal');
    return JSON.stringify({
      ok: true,
      catalogId: entry.id,
      enabled: goal.enabled,
      goal: publicGoalToChatCardGoal(goal),
    });
  } catch (err) {
    log.warn({ err, userId, catalogId: entry.id }, 'Chat toggle_catalog_goal failed');
    return JSON.stringify({ error: errMsg(err) });
  }
}

async function handleOfferComplete(userId: string, bag: GoalToolBag, args: OfferCompleteArgs): Promise<string> {
  try {
    const state = await getGoalsToday(userId);
    const dueOpen = state.goals.filter((g) => g.dueToday && !g.completedToday);
    let match: PublicGoal | undefined;

    if (args.goalId) {
      match = state.goals.find((g) => g.id === args.goalId);
    } else if (args.query?.trim()) {
      const pool = dueOpen.length ? dueOpen : state.goals.filter((g) => g.dueToday);
      const ranked = pool
        .map((g) => ({ g, score: scoreMatch(g, args.query!) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
      match = ranked[0]?.g;
    } else {
      match = dueOpen[0];
    }

    if (!match) {
      return JSON.stringify({ error: 'No matching goal to check off' });
    }

    pushCard(bag, { kind: 'complete', goal: publicGoalToChatCardGoal(match) });
    log.info({ userId, goalId: match.id, completedToday: match.completedToday }, 'Chat offered goal complete');
    return JSON.stringify({
      ok: true,
      completedToday: match.completedToday,
      dueToday: match.dueToday,
      goal: publicGoalToChatCardGoal(match),
    });
  } catch (err) {
    log.warn({ err, userId }, 'Chat offer_complete_goal failed');
    return JSON.stringify({ error: errMsg(err) });
  }
}

const CATALOG_IDS = GOAL_CATALOG.map((e) => e.id);

export function createGoalTools(userId: string, bag: GoalToolBag, userMessage?: string) {
  return [
    {
      type: 'function' as const,
      function: {
        name: 'create_goal',
        description:
          'Create a CUSTOM goal from what the user described. Always use this for specific habits ("Deep clean kitchen", "water plants") even if a premade goal is similar. Never remap onto Clean up / Take a walk / etc. Sunday=0 … Saturday=6. Use once for one-time goals. A card is shown automatically.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short 2–6 word name only, e.g. Deep clean kitchen — never the full sentence' },
            notes: { type: 'string', description: 'Optional extra detail' },
            repeat: {
              type: 'string',
              enum: ['daily', 'weekdays', 'once'],
              description:
                'daily = every day. weekdays = only repeatDays. once = one time; it stays checked until the next calendar day, then leaves the list.',
            },
            repeatDays: {
              type: 'array',
              items: { type: 'integer', minimum: 0, maximum: 6 },
              description: 'Required when repeat is weekdays. Sunday=0 … Saturday=6. Saturday=6.',
            },
            remindAt: {
              type: 'string',
              description: 'Optional 24h reminder HH:mm in the user timezone, e.g. 18:00',
            },
            iconItemType: {
              type: 'string',
              description: 'Optional icon from the goal icon picker. Omit to auto-pick.',
            },
          },
          required: ['title'],
        },
        parse: (input: string): CreateGoalArgs => {
          const parsed = JSON.parse(input) as CreateGoalArgs;
          return {
            title: parsed.title,
            notes: parsed.notes,
            fromText: userMessage || parsed.fromText,
            repeat: parsed.repeat,
            repeatDays: parsed.repeatDays,
            remindAt: parsed.remindAt,
            iconItemType: parsed.iconItemType,
          };
        },
        function: async (args: CreateGoalArgs) => handleCreateGoal(userId, bag, args, userMessage),
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'toggle_catalog_goal',
        description:
          'Turn a PREMADE catalog goal on or off only. Do not use this for specific custom habits. Do not change days or reminders. catalog ids: ' +
          CATALOG_IDS.join(', ') +
          '.',
        parameters: {
          type: 'object',
          properties: {
            catalogId: {
              type: 'string',
              enum: CATALOG_IDS,
              description: 'Premade id, e.g. clean_up, stretch, take_a_walk',
            },
            title: {
              type: 'string',
              description: 'Exact premade name if you do not have catalogId, e.g. Clean up',
            },
            enabled: { type: 'boolean', description: 'true = on, false = off' },
          },
          required: ['enabled'],
        },
        parse: (input: string): ToggleCatalogArgs => {
          const parsed = JSON.parse(input) as ToggleCatalogArgs;
          return {
            catalogId: parsed.catalogId,
            title: parsed.title,
            enabled: parsed.enabled,
          };
        },
        function: async (args: ToggleCatalogArgs) => handleToggleCatalog(userId, bag, args),
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'offer_complete_goal',
        description:
          'Show a tap-to-complete card for an existing goal. Use when the user says they did a goal, want to check one off, or ask to mark it done. Do NOT mark it complete yourself — the card does that. Pass goalId from the goals list when you have it, otherwise a title query.',
        parameters: {
          type: 'object',
          properties: {
            goalId: { type: 'string', description: 'UserGoal id from the goals list in context' },
            query: { type: 'string', description: 'Goal title to match if you do not have the id' },
          },
        },
        parse: (input: string): OfferCompleteArgs => {
          const parsed = JSON.parse(input) as OfferCompleteArgs;
          return { goalId: parsed.goalId, query: parsed.query };
        },
        function: async (args: OfferCompleteArgs) => handleOfferComplete(userId, bag, args),
      },
    },
  ];
}
