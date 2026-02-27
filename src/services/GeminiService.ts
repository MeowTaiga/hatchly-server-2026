import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { AppError } from '../middleware/errorHandler.js';

const log = createLogger('GeminiService');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ImageGenOptions {
  /** Imagen model variant — defaults to imagen-4.0-fast-generate-001 */
  model?: string;
  /** Number of images to return (1-4). Defaults to 1. */
  numberOfImages?: number;
  /** Output MIME type. Defaults to image/png. */
  outputMimeType?: 'image/png' | 'image/jpeg';
  /** Aspect ratio. Defaults to '1:1'. */
  aspectRatio?: '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
  /**
   * When true, replaces white / near-white pixels with transparency
   * after generation. Useful for pet sprites that need a clear background.
   * Defaults to false.
   */
  stripWhiteBackground?: boolean;
}

/**
 * How close a pixel must be to pure white (#FFF) to be treated as background.
 * 0 = only exact white, 30 ≈ anything above ~rgb(225,225,225).
 * 30 gives a clean cut without eating into light-coloured pets.
 */
const BG_STRIP_THRESHOLD = 30;

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * Google Gemini / Imagen API client for image generation.
 * Uses `imagen-4.0-fast-generate-001` (Imagen 4 Fast) by default
 * for fast, high-quality pet illustrations.
 *
 * Exported as a singleton (`geminiService`).
 */
class GeminiService {
  private client: GoogleGenAI | null;

  constructor() {
    if (env.GEMINI_API_KEY) {
      this.client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
      log.info('GeminiService initialised (Imagen 4 Fast)');
    } else {
      this.client = null;
      log.warn('GeminiService disabled — GEMINI_API_KEY not set');
    }
  }

  private requireClient(): GoogleGenAI {
    if (!this.client) {
      throw new AppError('Gemini API key not configured', 503, 'GEMINI_NOT_CONFIGURED');
    }
    return this.client;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Generates an image from a text prompt using Imagen 4 Fast
   * and returns it as a base64-encoded data URI.
   *
   * @param prompt — Description of the image to generate
   * @param opts   — Model, count, format, aspect ratio, background strip
   * @returns A `data:image/png;base64,...` string ready for the frontend or R2 upload
   */
  async generateImageBase64(prompt: string, opts: ImageGenOptions = {}): Promise<string> {
    const {
      model = 'imagen-4.0-fast-generate-001',
      numberOfImages = 1,
      outputMimeType = 'image/png',
      aspectRatio = '1:1',
      stripWhiteBackground = false,
    } = opts;

    try {
      log.info({ model, aspectRatio, stripWhiteBackground }, 'Generating image with Imagen 4 Fast');

      const response = await this.requireClient().models.generateImages({
        model,
        prompt,
        config: {
          numberOfImages,
          outputMimeType,
          aspectRatio,
        },
      });

      const imageBytes = response?.generatedImages?.[0]?.image?.imageBytes;
      if (!imageBytes) {
        throw new Error('No image data returned from Imagen');
      }

      let buffer: Buffer = Buffer.from(imageBytes, 'base64');

      if (stripWhiteBackground) {
        buffer = await GeminiService.removeWhiteBackground(buffer);
      }

      return `data:image/png;base64,${buffer.toString('base64')}`;
    } catch (err: any) {
      log.error({ err }, 'Imagen image generation failed');
      throw new AppError('AI image generation failed', 502, 'GEMINI_IMAGE_FAILED');
    }
  }

  /**
   * Generates multiple images from a prompt and returns all as base64 data URIs.
   *
   * @param prompt — Description of the image to generate
   * @param count  — Number of images (1-4)
   * @param opts   — Model, format, aspect ratio, background strip
   * @returns Array of `data:image/png;base64,...` strings
   */
  async generateImagesBase64(
    prompt: string,
    count: number = 1,
    opts: Omit<ImageGenOptions, 'numberOfImages'> = {},
  ): Promise<string[]> {
    const {
      model = 'imagen-4.0-fast-generate-001',
      outputMimeType = 'image/png',
      aspectRatio = '1:1',
      stripWhiteBackground = false,
    } = opts;

    try {
      log.info({ model, count, aspectRatio, stripWhiteBackground }, 'Generating multiple images with Imagen 4 Fast');

      const response = await this.requireClient().models.generateImages({
        model,
        prompt,
        config: {
          numberOfImages: count,
          outputMimeType,
          aspectRatio,
        },
      });

      const images = response?.generatedImages ?? [];
      if (images.length === 0) {
        throw new Error('No images returned from Imagen');
      }

      const results: string[] = [];
      for (const img of images) {
        const bytes = img?.image?.imageBytes;
        if (!bytes) continue;

        let buffer: Buffer = Buffer.from(bytes, 'base64');

        if (stripWhiteBackground) {
          buffer = await GeminiService.removeWhiteBackground(buffer);
        }

        results.push(`data:image/png;base64,${buffer.toString('base64')}`);
      }

      return results;
    } catch (err: any) {
      log.error({ err }, 'Imagen multi-image generation failed');
      throw new AppError('AI image generation failed', 502, 'GEMINI_IMAGE_FAILED');
    }
  }

  // ── Background Removal ───────────────────────────────────────────────────

  /**
   * Replaces white / near-white pixels with transparency using sharp.
   *
   * Uses a graduated alpha near the threshold boundary so edges around
   * the subject stay smooth (anti-aliased) rather than jagged.
   *
   * @param input — Raw PNG/JPEG buffer
   * @returns PNG buffer with transparent background
   */
  static async removeWhiteBackground(input: Buffer): Promise<Buffer> {
    const image = sharp(input).ensureAlpha();
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

    const { width, height, channels } = info;
    const t = BG_STRIP_THRESHOLD;

    for (let i = 0; i < data.length; i += channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Distance from pure white — 0 means exact white
      const distFromWhite = Math.max(255 - r, 255 - g, 255 - b);

      if (distFromWhite < t) {
        // Graduated alpha for smooth edges: fully transparent at white,
        // blending to opaque as we approach the threshold boundary
        data[i + 3] = Math.round((distFromWhite / t) * 255);
      }
      // Pixels beyond the threshold keep their original alpha
    }

    return sharp(data, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
  }
}

/** Singleton — import this, don't instantiate the class directly */
export const geminiService = new GeminiService();
