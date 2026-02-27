import { openAIService } from './OpenAIService.js';
import type { YesterdaySummary } from '../utils/getYesterdaySummary.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('PetGreetingService');

export interface PetState {
  hunger: number;
  happy: number;
  mood: number;
  customName?: string;
  name?: string;
}

/**
 * Builds a shared context string for pet persona. Used by both daily and returning greetings.
 */
function buildPetContextPrompt(petState: PetState): string {
  const name = petState.customName || petState.name || 'Buddy';
  return `Pet stats: hunger ${petState.hunger}, happy ${petState.happy}, mood ${petState.mood}. Pet name: ${name}.`;
}

/**
 * Generates a daily greeting for first login of the day, using yesterday's activity summary.
 */
export async function getDailyGreeting(userId: string, yesterdaySummary: YesterdaySummary, petState: PetState): Promise<string> {
  const context = buildPetContextPrompt(petState);
  const summary = [
    `Food logs: ${yesterdaySummary.foodLogCount}`,
    `Water: ${yesterdaySummary.waterOz} oz`,
    yesterdaySummary.weightLbs != null ? `Weight: ${yesterdaySummary.weightLbs} lbs` : null,
    `Quests completed: ${yesterdaySummary.questsCompleted}`,
    `Fish caught: ${yesterdaySummary.fishCaught}`,
    `Bugs caught: ${yesterdaySummary.bugsCaught}`,
  ]
    .filter(Boolean)
    .join('. ');

  const messages = [
    {
      role: 'system' as const,
      content: `You are a cute, supportive pet companion in a wellness + farming game. Write a short, heartfelt, motivational greeting (2-3 sentences) for the user based on their yesterday's activity. Be warm and encouraging. ${context}`,
    },
    {
      role: 'user' as const,
      content: `Yesterday's activity: ${summary}`,
    },
  ];

  try {
    const greeting = await openAIService.chatCompletion(messages, {
      model: 'gpt-4.1-nano',
      temperature: 0.8,
      maxTokens: 150,
    });
    return greeting.trim() || "Good morning! I'm so glad you're here. Let's make today great!";
  } catch (err) {
    log.warn({ err, userId }, 'AI daily greeting failed, using fallback');
    return "Good morning! I'm so glad you're here. Let's make today great!";
  }
}

/**
 * Generates a welcome-back greeting for users inactive for 2+ hours.
 */
export async function getReturningUserGreeting(userId: string, petState: PetState): Promise<string> {
  const context = buildPetContextPrompt(petState);

  const messages = [
    {
      role: 'system' as const,
      content: `You are a cute, supportive pet companion in a wellness + farming game. The user has been away for a while. Write a short, warm welcome-back message (1-2 sentences). Personalize based on pet state: if hungry, mention it playfully; if happy, say you missed them. ${context}`,
    },
    {
      role: 'user' as const,
      content: 'Generate a welcome back message.',
    },
  ];

  try {
    const greeting = await openAIService.chatCompletion(messages, {
      model: 'gpt-4.1-nano',
      temperature: 0.8,
      maxTokens: 100,
    });
    return greeting.trim() || "Welcome back! I missed you!";
  } catch (err) {
    log.warn({ err, userId }, 'AI returning greeting failed, using fallback');
    return "Welcome back! I missed you!";
  }
}
