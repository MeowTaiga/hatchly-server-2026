import OpenAI, { toFile } from 'openai';
import { env } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { AppError } from '../middleware/errorHandler.js';

const log = createLogger('OpenAIService');

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatWithToolsResult {
  content: string;
  completionId?: string;
}


export interface ImageOptions {
  model?: string;
  size?: '1024x1024' | '1536x1024' | '1024x1536';
  quality?: 'low' | 'medium' | 'high';
  outputFormat?: 'png' | 'jpeg' | 'webp';
  background?: 'transparent' | 'opaque' | 'auto';
}

/**
 * OpenAI API client for chat completions and image generation.
 * Exported as a singleton (`openAIService`).
 */
class OpenAIService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    log.info('OpenAIService initialised');
  }

  /**
   * Chat completion with tools (agentic flow). Uses runTools for function calling.
   * When the model returns tool_calls, they are executed and the loop continues until stop.
   *
   * @param messages — Conversation history
   * @param tools    — Tools (e.g. query_user_data) with userId bound in closure
   * @param opts    — Model, temperature, max tokens
   */
  async chatCompletionWithTools(
    messages: ChatMessage[],
    tools: Array<{ type: 'function'; function: Record<string, unknown> }>,
    opts: ChatOptions = {},
  ): Promise<ChatWithToolsResult> {
    const { model = 'gpt-4.1-mini', temperature = 0.7, maxTokens = 1024 } = opts;

    try {
      const runner = this.client.chat.completions.runTools({
        model,
        messages,
        tools: tools as unknown as Parameters<typeof this.client.chat.completions.runTools>[0]['tools'],
        temperature,
        max_tokens: maxTokens,
        store: true,
      });

      const [content, completion] = await Promise.all([
        runner.finalContent(),
        runner.finalChatCompletion(),
      ]);

      return {
        content: content ?? '',
        completionId: completion?.id,
      };
    } catch (err: any) {
      log.error({ err }, 'Chat completion with tools failed');
      throw new AppError('AI chat request failed', 502, 'OPENAI_CHAT_FAILED');
    }
  }

  /**
   * Sends a chat completion request and returns the assistant's reply text.
   *
   * @param messages — Conversation history
   * @param opts     — Model, temperature, max tokens overrides
   */
  async chatCompletion(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const { model = 'gpt-4.1-mini', temperature = 0.7, maxTokens = 1024 } = opts;

    try {
      const response = await this.client.chat.completions.create({ model, messages, temperature });

      const content = response.choices[0]?.message?.content ?? '';
      const finishReason = response.choices[0]?.finish_reason;
      if (!content || content.length < 10) {
        log.warn(
          { model, contentLen: content.length, finishReason, choiceCount: response.choices?.length },
          'Chat completion returned empty or very short content',
        );
      }
      return content;
    } catch (err: any) {
      log.error({ err }, 'Chat completion failed');
      throw new AppError('AI chat request failed', 502, 'OPENAI_CHAT_FAILED');
    }
  }

  /**
   * Generates an image from a text prompt and returns the image URL(s).
   *
   * @param prompt — Description of the image to generate
   * @param opts   — Model, size, quality overrides
   */
  async generateImage(prompt: string, opts: ImageOptions = {}): Promise<string[]> {
    const { model = 'gpt-image-1.5', size = '1024x1024', quality = 'medium' } = opts;

    try {
      const response = await this.client.images.generate({
        model,
        prompt,
        n: 1,
        size,
        quality,
      });

      return (response.data ?? []).map((d) => d.url).filter(Boolean) as string[];
    } catch (err: any) {
      log.error({ err }, 'Image generation failed');
      throw new AppError('AI image generation failed', 502, 'OPENAI_IMAGE_FAILED');
    }
  }

  /**
   * Generates an image and returns it as a base64-encoded data URI.
   * Uses gpt-image-1-mini by default for fast, cheap pet generation.
   *
   * @param prompt — Description of the image to generate
   * @param opts   — Model, size, quality, format overrides
   */
  async generateImageBase64(prompt: string, opts: ImageOptions = {}): Promise<string> {
    const {
      model = 'gpt-image-1.5',
      size = '1024x1024',
      quality = 'low',
      outputFormat = 'png',
      background = 'auto',
    } = opts;

    try {
      const response = await this.client.images.generate({
        model,
        prompt,
        n: 1,
        size,
        quality,
        output_format: outputFormat,
        background,
      } as any);

      const b64 = (response.data ?? [])[0]?.b64_json;
      if (!b64) throw new Error('No image data returned');

      return `data:image/${outputFormat};base64,${b64}`;
    } catch (err: any) {
      log.error({ err }, 'Base64 image generation failed');
      throw new AppError('AI image generation failed', 502, 'OPENAI_IMAGE_FAILED');
    }
  }
  /**
   * Generates an image using a reference image for style consistency.
   * Uses the images.edit endpoint with gpt-image-1.
   *
   * @param referenceBase64 — Raw base64 image data (no data URI prefix)
   * @param prompt          — Description of the variant to generate
   * @param opts            — Size, quality, format, input_fidelity overrides
   */
  async editImageBase64(
    referenceBase64: string,
    prompt: string,
    opts: Omit<ImageOptions, 'model'> & { inputFidelity?: 'high' | 'low' } = {},
  ): Promise<string> {
    const { size = '1024x1024', quality = 'medium', outputFormat = 'png', background = 'transparent', inputFidelity } = opts;

    try {
      const refBuffer = Buffer.from(referenceBase64, 'base64');
      const refFile = await toFile(refBuffer, 'reference.png', { type: 'image/png' });

      const body: Record<string, unknown> = {
        model: 'gpt-image-1',
        image: refFile,
        prompt,
        size,
        quality,
        background,
      };
      if (inputFidelity) body.input_fidelity = inputFidelity;

      const response = await this.client.images.edit(body as any);

      const b64 = (response.data ?? [])[0]?.b64_json;
      if (!b64) throw new Error('No image data returned from edit');
      return `data:image/${outputFormat};base64,${b64}`;
    } catch (err: any) {
      log.error({ err }, 'Reference image edit failed');
      throw new AppError('AI reference image generation failed', 502, 'OPENAI_EDIT_FAILED');
    }
  }
}

/** Singleton — import this, don't instantiate the class directly */
export const openAIService = new OpenAIService();
