import axios from 'axios';
import { createLogger } from '../config/logger.js';

const log = createLogger('DiscordService');

/** Hatchly marketing / analytics webhook (cute visitor cards). */
const ANALYTICS_WEBHOOK =
  'https://discord.com/api/webhooks/1538320439330209903/M1meQpQsOyK4rOmjcg_IzGmUhweLsQtlFFvDg1PePdeU5OolfSLpNUoV9qntX3594lkH';

const EMBED_PINK = 0xff6b9d;
const FOOTER = "Let's make their day magical! (ノ◕ヮ◕)ノ*:・ﾟ✧";

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
}

function cuteCard(opts: {
  title: string;
  description: string;
  fields: Array<{ name: string; value: string }>;
}): DiscordEmbed {
  return {
    title: opts.title,
    description: opts.description,
    color: EMBED_PINK,
    fields: opts.fields.map((f) => ({ ...f, inline: false })),
    footer: { text: FOOTER },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Sends notifications to Discord via webhook.
 * Analytics webhook is hardcoded; optional DISCORD_WEBHOOK_URL still works for notify().
 */
class DiscordService {
  private webhookUrl: string;

  constructor() {
    this.webhookUrl = process.env.DISCORD_WEBHOOK_URL?.trim() || ANALYTICS_WEBHOOK;
    log.info('DiscordService initialised');
  }

  /**
   * Posts a message (and optional embeds) to Discord.
   * Never throws — analytics must not break request flows.
   */
  async notify(content: string, embeds?: DiscordEmbed[]): Promise<void> {
    if (!this.webhookUrl) return;

    try {
      await axios.post(this.webhookUrl, { content: content || undefined, embeds }, { timeout: 8000 });
      log.debug('Discord notification sent');
    } catch (err) {
      log.warn({ err }, 'Discord notification failed (non-critical)');
    }
  }

  async notifyEmbed(embed: DiscordEmbed): Promise<void> {
    await this.notify('', [embed]);
  }

  /** Marketing site visit card */
  async trackVisit(opts: { url: string; userAgent: string; ip: string }): Promise<void> {
    await this.notifyEmbed(
      cuteCard({
        title: '✨ Hatchly Visitor Spotted! ✨',
        description: `A User has visited ${opts.url.slice(0, 500)}`,
        fields: [
          { name: 'Browser', value: opts.userAgent.slice(0, 1024) || 'unknown' },
          { name: 'IP Address', value: opts.ip || 'unknown' },
        ],
      }),
    );
  }

  /** Marketing CTA / button click card */
  async trackClick(opts: {
    url: string;
    userAgent: string;
    ip: string;
    label: string;
  }): Promise<void> {
    const label = opts.label.slice(0, 120) || 'button';
    await this.notifyEmbed(
      cuteCard({
        title: '✨ Hatchly Click Spotted! ✨',
        description: `A User clicked **${label}** on ${opts.url.slice(0, 500)}`,
        fields: [
          { name: 'Clicked', value: label },
          { name: 'Browser', value: opts.userAgent.slice(0, 1024) || 'unknown' },
          { name: 'IP Address', value: opts.ip || 'unknown' },
        ],
      }),
    );
  }

  /** Waitlist signup card */
  async trackWaitlist(opts: {
    email: string;
    ip: string;
    source?: string;
    alreadyJoined?: boolean;
  }): Promise<void> {
    await this.notifyEmbed(
      cuteCard({
        title: opts.alreadyJoined
          ? '✨ Waitlist Hello Again! ✨'
          : '✨ New Waitlist Hatchling! ✨',
        description: opts.alreadyJoined
          ? `Someone re-submitted **${opts.email}** (already on the list).`
          : `**${opts.email}** joined the Hatchly beta waitlist!`,
        fields: [
          { name: 'Email', value: opts.email },
          { name: 'Source', value: opts.source || 'marketing' },
          { name: 'IP Address', value: opts.ip || 'unknown' },
        ],
      }),
    );
  }
}

/** Singleton — import this, don't instantiate the class directly */
export const discordService = new DiscordService();
