import axios from 'axios';
import { isProd } from '../config/env.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('DiscordService');

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  timestamp?: string;
}

/**
 * Sends notifications to a Discord channel via webhook.
 * Only fires in production — silently no-ops in dev/test.
 * Exported as a singleton (`discordService`).
 */
class DiscordService {
  private webhookUrl: string | null;

  constructor() {
    this.webhookUrl = process.env.DISCORD_WEBHOOK_URL ?? null;
    log.info('DiscordService initialised');
  }

  /**
   * Posts a message (and optional embeds) to the configured Discord webhook.
   * Silently no-ops if:
   * - Not in production
   * - No webhook URL configured
   *
   * @param content — Plain text message
   * @param embeds  — Optional rich embeds
   */
  async notify(content: string, embeds?: DiscordEmbed[]): Promise<void> {
    if (!isProd || !this.webhookUrl) return;

    try {
      await axios.post(this.webhookUrl, { content, embeds });
      log.debug('Discord notification sent');
    } catch (err: any) {
      // Non-critical — log and swallow so it never breaks the main flow
      log.warn({ err }, 'Discord notification failed (non-critical)');
    }
  }
}

/** Singleton — import this, don't instantiate the class directly */
export const discordService = new DiscordService();
