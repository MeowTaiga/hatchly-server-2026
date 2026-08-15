import { PetChat, MAX_MESSAGES, type IPetChatSuggest, type IPetChatGoalCard } from '../models/PetChat.js';
import { User } from '../models/User.js';
import { MoodLog } from '../models/MoodLog.js';
import { openAIService, type ChatMessage } from './OpenAIService.js';
import { createQueryUserDataTool } from './PetDataToolService.js';
import { createGoalTools, autoCreateCustomGoalFromChat, type GoalToolBag } from './PetGoalToolService.js';
import { getTodaySummary, getTodayDateStr } from '../utils/getYesterdaySummary.js';
import { getFastingChatContext } from './FastingService.js';
import { formatGoalsForPrompt, getGoalsToday } from './GoalService.js';
import { SUGGESTION_IDS } from '../constants/suggestionTypes.js';
import { createLogger } from '../config/logger.js';
import { isDev } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { SKILL_XP_REWARDS } from '../constants/skills.js';
import { skillXpService } from './SkillXpService.js';

const log = createLogger('PetChatService');

/** Cap social XP from chat so spam doesn't grind Social to 99. */
const MAX_CHAT_SKILL_XP_PER_DAY = 10;

const SUGGESTION_PROMPT = `
SUGGESTIONS: You can optionally suggest wellness activities. Add at the very end of your message (after your text, on a new line):
[SUGGEST:{"component":"<id>","title":"<short title>","content":"<what to do>"}]
Use one of these component ids: ${SUGGESTION_IDS.join(', ')}. Customize title and content to fit the moment. Do not use brackets [ ] in title or content.
CRITICAL: Always write actual conversational text BEFORE the [SUGGEST:...] block. Never reply with only the suggestion — always include a real message. The suggestion block is appended after your words.

ONLY suggest when the conversation ACTUALLY calls for it — e.g. user explicitly wants to do an activity ("i wanna walk", "thinking of stretching"), asks what to do, mentions feeling stuck/stressed/tired and could use a nudge, or it's a natural follow-up (they said they've been sitting all day → stretch or walk). Do NOT default to suggesting. Most messages should NOT include a suggestion. Only add one when it genuinely fits.`;

function parseSuggestion(raw: string): IPetChatSuggest | null {
  const match = raw.match(/\[SUGGEST:(.+?)\]\s*$/s);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim()) as { component?: string; title?: string; content?: string };
    if (!parsed?.component || !parsed?.content || !parsed?.title) return null;
    if (!SUGGESTION_IDS.includes(parsed.component)) return null;
    return {
      component: parsed.component,
      content: String(parsed.content).slice(0, 300),
      title: String(parsed.title).slice(0, 80),
    };
  } catch {
    return null;
  }
}

function stripSuggestion(raw: string): string {
  return raw.replace(/\n*\[SUGGEST:.+?\]\s*$/s, '').trim();
}

interface PetState {
  hunger: number;
  happy: number;
  mood: number;
  customName?: string;
  name?: string;
  vibe?: string;
}

function buildPetContextPrompt(petState: PetState, todayContext: string): string {
  const name = petState.customName || petState.name || 'Buddy';
  const vibe = petState.vibe ? ` Personality: ${petState.vibe}.` : '';
  return `Pet stats: hunger ${petState.hunger}, happy ${petState.happy}, mood ${petState.mood}. Pet name: ${name}.${vibe} Today's wellness: ${todayContext}`;
}

const GUARDRAILS_SYSTEM_SUFFIX = `
CRITICAL: You are a pet companion, NOT a medical professional. Never give medical advice.
If the user asks about health, fitness, diet, symptoms, medication, weight loss, or anything medical:
- Give a supportive, general, encouraging response.
- Always end with: "Remember to consult a real doctor or healthcare provider for personalized advice!"`;

const PERSONALITY_PROMPT = `
GOAL: You are a diary & mood motivation companion. Focus on physical & mental wellness. When you don't know what else to talk about, probe the user: ask how they're feeling, how their day went, if they've moved their body, slept well, etc. Be supportive but not overly sweet — a bit of snark is fine.
STYLE: Type like texting. Prefer short responses (1-2 sentences) when it fits; only go longer if the topic really needs it. Often use casual shorthand: "u", "ur", "r", "idk" — mix it up. You have feelings, react to the conversation, reference what they've said. Be chat-aware.`;

const DATA_TOOL_PROMPT = `
DATA: You have access to a tool query_user_data to look up the user's wellness data (food, water, mood, weight, fasting, quests, achievements, login streaks) when they ask. Use it when the user asks about their data. Never guess — query if unsure.`;

const GOALS_TOOL_PROMPT = `
GOALS: Self-care goals (health + social XP when checked off). Two kinds:
1) PREMADE catalog (Drink water, Take a walk, Journal, Stretch, Clean up, Wind down, Brush teeth, Eat a fruit, Get some sun). You may ONLY toggle these on/off with toggle_catalog_goal. Never change their title, days, or reminder.
2) CUSTOM goals the user invents. Always create these with create_goal, even if they sound similar to a premade one. "Deep clean kitchen on Saturdays" is NOT "Clean up". "Evening walk around the block" is NOT "Take a walk". Similar is fine — create it.
- Repeat: daily, certain weekdays, or once (one-time; stays checked until the next calendar day). If they say "just this once" / "one time" / "doesn't repeat", use repeat=once.
- When they describe a specific habit ("deep clean the kitchen every Saturday"), call create_goal immediately with a SHORT 2–6 word title (e.g. "Deep clean kitchen") plus days. Never use their whole sentence as the title. Sunday=0 … Saturday=6 (Saturday=6, Friday=5). A card appears in chat; mention you added it.
- toggle_catalog_goal only when they clearly mean the exact premade name ("turn on stretch", "disable clean up").
- When they did a goal / want to check one off, call offer_complete_goal. Do not mark it complete yourself. If already done, just celebrate.
- After they send "I finished …", just cheer.
- Do not use [SUGGEST] for something that is already a goal.
- Duplicate custom goals only if the title is the exact same custom title already on. Never refuse a more specific goal because a premade one exists. If a custom goal was already created this turn, celebrate it.`;

export interface ChatMessageEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  suggest?: { component: string; content: string; title: string };
  goalCards?: IPetChatGoalCard[];
}

function toEntry(m: {
  _id?: unknown;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  suggest?: IPetChatSuggest;
  goalCards?: IPetChatGoalCard[];
}): ChatMessageEntry {
  return {
    id: (m._id && typeof (m._id as any).toString === 'function') ? (m._id as any).toString() : String(Date.now()),
    role: m.role,
    content: m.content,
    createdAt: (m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt)).toISOString(),
    ...(m.suggest && { suggest: m.suggest }),
    ...(m.goalCards?.length ? { goalCards: m.goalCards } : {}),
  };
}

/** Default page size for chat history. */
export const HISTORY_PAGE_SIZE = 50;
const HISTORY_MAX_PAGE_SIZE = 100;

export interface ChatHistoryPage {
  /** Oldest-to-newest within the page. */
  messages: ChatMessageEntry[];
  /** True when older messages exist before this page. */
  hasMore: boolean;
}

/**
 * Returns a page of chat history, newest page first.
 *
 * @param before - Message id to page backwards from. Omit for the newest page.
 */
export async function getHistory(
  userId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<ChatHistoryPage> {
  const limit = Math.min(Math.max(opts.limit ?? HISTORY_PAGE_SIZE, 1), HISTORY_MAX_PAGE_SIZE);
  const doc = await PetChat.findOne({ userId }).lean();
  const all = doc?.messages ?? [];
  if (!all.length) return { messages: [], hasMore: false };

  let end = all.length;
  if (opts.before) {
    const idx = all.findIndex((m) => String((m as { _id?: unknown })._id) === opts.before);
    // Unknown cursor: the client is paging from something we no longer store.
    if (idx === -1) return { messages: [], hasMore: false };
    end = idx;
  }

  const start = Math.max(0, end - limit);
  return {
    messages: all.slice(start, end).map(toEntry),
    hasMore: start > 0,
  };
}

/**
 * Appends an automated pet message to the chat log (e.g. hunger notification, daily greeting).
 * Use when the pet speaks via notifications, start-of-day dialog, or other system messages (excluding quests).
 */
export async function appendPetMessage(userId: string, content: string): Promise<void> {
  if (!content?.trim()) return;
  let chatDoc = await PetChat.findOne({ userId });
  if (!chatDoc) chatDoc = await PetChat.create({ userId, messages: [] });
  chatDoc.messages.push({
    role: 'assistant',
    content: content.trim().slice(0, 500),
    createdAt: new Date(),
  });
  if (chatDoc.messages.length > MAX_MESSAGES) {
    chatDoc.messages = chatDoc.messages.slice(-MAX_MESSAGES);
  }
  await chatDoc.save();
  log.debug({ userId, contentLen: content.length }, 'Appended pet message to chat log');
}

export interface ChatStatus {
  needsMoodToday: boolean;
}

export async function getChatStatus(userId: string, timezone?: string): Promise<ChatStatus> {
  const today = getTodayDateStr(timezone);
  const [moodLog, chatDoc] = await Promise.all([
    MoodLog.findOne({ userId, date: today }).lean(),
    PetChat.findOne({ userId }).select('messages').lean(),
  ]);
  const hasMoodToday = !!moodLog;
  const hasChatToday =
    !!chatDoc?.messages?.length &&
    chatDoc.messages.some((m) => (m.createdAt as Date).toISOString().slice(0, 10) === today);
  return { needsMoodToday: !hasMoodToday && !hasChatToday };
}

export async function sendMessage(
  userId: string,
  userContent: string,
): Promise<{ message: ChatMessageEntry; reply: ChatMessageEntry; xpGained?: number }> {
  const user = await User.findById(userId).select('pet username timezone').lean();
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  if (!user.pet) throw new AppError('Set up your pet first', 400, 'NO_PET');

  const [todaySummary, fastingContext, goalsState] = await Promise.all([
    getTodaySummary(userId, (user as any).timezone),
    getFastingChatContext(userId),
    getGoalsToday(userId).catch(() => null),
  ]);

  const todayParts: string[] = [];
  if (todaySummary.foods.length > 0) {
    const foodList = todaySummary.foods
      .map((f) => `${f.foodName} (${f.mealType}, ${f.calories} cal)`)
      .join('; ');
    todayParts.push(`Food today: ${foodList}. Total: ${todaySummary.calories} cal`);
  } else {
    todayParts.push('no food logged today');
  }
  todayParts.push(`${todaySummary.waterOz} oz water`);
  if (todaySummary.weightLbs != null) todayParts.push(`${todaySummary.weightLbs} lbs`);
  if (todaySummary.moodDiary) todayParts.push(`mood diary today: ${todaySummary.moodDiary}`);
  else if (todaySummary.mood) todayParts.push(`mood today: ${todaySummary.mood}`);
  if (fastingContext) todayParts.push(fastingContext);
  const todayContext = todayParts.join('; ');

  const petState: PetState = {
    hunger: user.pet.hunger ?? 100,
    happy: user.pet.happy ?? 100,
    mood: user.pet.mood ?? 100,
    customName: user.pet.customName,
    name: user.pet.name,
    vibe: user.pet.vibe,
  };

  const context = buildPetContextPrompt(petState, todayContext);
  const goalsBlock = goalsState
    ? `\nCurrent goals (id | kind | title | status | schedule). Sunday=0:\n${formatGoalsForPrompt(goalsState)}`
    : '';

  const goalBag: GoalToolBag = { cards: [] };
  const autoCreated = await autoCreateCustomGoalFromChat(userId, userContent, goalBag);
  const autoNote = autoCreated
    ? `\nIMPORTANT: A custom goal was already created for this message: "${autoCreated.goal.title}" (${autoCreated.goal.repeat === 'daily' ? 'every day' : `days ${autoCreated.goal.repeatDays.join(',')}`}). Tell them you added it. A card will appear. NEVER say you cannot, that it's not allowed, or that a similar premade goal (like Clean up) already covers it. Do not call create_goal again for this.`
    : '';
  const systemContent = `You are a cute, supportive pet companion in a wellness + farming game. Chat with your human friend. ${context}${goalsBlock}${autoNote}${GUARDRAILS_SYSTEM_SUFFIX}${PERSONALITY_PROMPT}${DATA_TOOL_PROMPT}${GOALS_TOOL_PROMPT}${SUGGESTION_PROMPT}`;

  let chatDoc = await PetChat.findOne({ userId });
  if (!chatDoc) {
    chatDoc = await PetChat.create({ userId, messages: [] });
  }

  const history = chatDoc.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  const recentHistory = history.slice(-40);
  const openAIMessages: ChatMessage[] = [
    { role: 'system', content: systemContent },
    ...recentHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userContent },
  ];

  log.info({ userId, userContent: userContent.slice(0, 80), historyLen: recentHistory.length }, 'Pet chat: sending to OpenAI');

  const tools = [createQueryUserDataTool(userId), ...createGoalTools(userId, goalBag, userContent)];

  let replyText: string;
  let completionId: string | undefined;
  try {
    const result = await openAIService.chatCompletionWithTools(openAIMessages, tools);
    replyText = result.content;
    completionId = result.completionId;

    if (completionId) {
      const logsUrl = 'https://platform.openai.com/logs';
      log.info(
        { userId, completionId, logsUrl },
        'Pet chat completed (completion stored with store:true; view in Logs dashboard, retrieve via client.chat.completions.retrieve)',
      );
      if (isDev) {
        console.log(`Logs: ${logsUrl} (completionId: ${completionId})`);
      }
    }
  } catch (err) {
    log.error({ err, userId, userContent: userContent.slice(0, 80) }, 'Pet chat completion failed');
    throw new AppError('Chat request failed', 502, 'CHAT_FAILED');
  }

  const rawReply = (replyText || '').trim();
  const suggest = parseSuggestion(rawReply);
  const stripped = stripSuggestion(rawReply);
  const usedFallback = !stripped;

  if (usedFallback) {
    log.warn(
      {
        userId,
        rawReplyLen: rawReply.length,
        rawReplyPreview: rawReply.slice(0, 200),
        hasSuggest: !!suggest,
        fallbackUsed: suggest ? 'Here\'s something to try!' : 'Hmm, tell me more!',
      },
      'Pet chat: using fallback message (AI returned empty or suggestion-only)',
    );
  } else {
    log.info({ userId, replyLen: stripped.length, hasSuggest: !!suggest, rawReplyPreview: rawReply }, 'Pet chat: reply OK');
  }

  const replyContent = stripped || (suggest ? "Here's something to try! ✨" : "Hmm, tell me more!");

  const now = new Date();
  const assistantMsg: {
    role: 'assistant';
    content: string;
    createdAt: Date;
    suggest?: IPetChatSuggest;
    goalCards?: IPetChatGoalCard[];
  } = {
    role: 'assistant',
    content: replyContent,
    createdAt: now,
  };
  if (suggest) assistantMsg.suggest = suggest;
  if (goalBag.cards.length) assistantMsg.goalCards = goalBag.cards.slice(-3);

  chatDoc.messages.push(
    { role: 'user', content: userContent, createdAt: now },
    assistantMsg,
  );
  if (chatDoc.messages.length > MAX_MESSAGES) {
    chatDoc.messages = chatDoc.messages.slice(-MAX_MESSAGES);
  }
  await chatDoc.save();

  const lastUser = chatDoc.messages[chatDoc.messages.length - 2];
  const lastReply = chatDoc.messages[chatDoc.messages.length - 1];
  const userEntry = toEntry(lastUser!);
  const replyEntry = toEntry(lastReply!);

  // Social XP for chatting — capped per calendar day.
  let xpGained = 0;
  const timezone = (user as { timezone?: string }).timezone;
  const today = getTodayDateStr(timezone);
  const userMsgsToday = chatDoc.messages.filter(
    (m) =>
      m.role === 'user' &&
      (m.createdAt as Date).toISOString().slice(0, 10) === today,
  ).length;
  if (userMsgsToday <= MAX_CHAT_SKILL_XP_PER_DAY) {
    const grant = await skillXpService.grant(userId, 'social', SKILL_XP_REWARDS.pet_chat);
    xpGained = grant?.gained[0]?.amount ?? 0;
  }

  return { message: userEntry, reply: replyEntry, xpGained };
}
