import { PetChat, MAX_MESSAGES, type IPetChatSuggest } from '../models/PetChat.js';
import { User } from '../models/User.js';
import { MoodLog } from '../models/MoodLog.js';
import { openAIService, type ChatMessage } from './OpenAIService.js';
import { createQueryUserDataTool } from './PetDataToolService.js';
import { getTodaySummary, getTodayDateStr } from '../utils/getYesterdaySummary.js';
import { SUGGESTION_IDS } from '../constants/suggestionTypes.js';
import { createLogger } from '../config/logger.js';
import { isDev } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

const log = createLogger('PetChatService');

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
DATA: You have access to a tool query_user_data to look up the user's wellness data (food, water, mood, weight, quests, achievements, login streaks) when they ask. Use it when the user asks about their data. Never guess — query if unsure.`;

export interface ChatMessageEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  suggest?: { component: string; content: string; title: string };
}

function toEntry(m: {
  _id?: unknown;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  suggest?: IPetChatSuggest;
}): ChatMessageEntry {
  return {
    id: (m._id && typeof (m._id as any).toString === 'function') ? (m._id as any).toString() : String(Date.now()),
    role: m.role,
    content: m.content,
    createdAt: (m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt)).toISOString(),
    ...(m.suggest && { suggest: m.suggest }),
  };
}

export async function getHistory(userId: string, timezone?: string): Promise<ChatMessageEntry[]> {
  const doc = await PetChat.findOne({ userId }).lean();
  if (!doc?.messages?.length) return [];
  return doc.messages.map(toEntry);
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

export async function sendMessage(userId: string, userContent: string): Promise<{ message: ChatMessageEntry; reply: ChatMessageEntry }> {
  const user = await User.findById(userId).select('pet username timezone').lean();
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  if (!user.pet) throw new AppError('Set up your pet first', 400, 'NO_PET');

  const todaySummary = await getTodaySummary(userId, (user as any).timezone);

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
  if (todaySummary.mood) todayParts.push(`mood today: ${todaySummary.mood}`);
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
  const systemContent = `You are a cute, supportive pet companion in a wellness + farming game. Chat with your human friend. ${context}${GUARDRAILS_SYSTEM_SUFFIX}${PERSONALITY_PROMPT}${DATA_TOOL_PROMPT}${SUGGESTION_PROMPT}`;

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

  const tools = [createQueryUserDataTool(userId)];

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
  const assistantMsg: { role: 'assistant'; content: string; createdAt: Date; suggest?: IPetChatSuggest } = {
    role: 'assistant',
    content: replyContent,
    createdAt: now,
  };
  if (suggest) assistantMsg.suggest = suggest;

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

  return { message: userEntry, reply: replyEntry };
}
