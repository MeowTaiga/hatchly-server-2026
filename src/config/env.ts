import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Zod schema that validates every environment variable at startup.
 * If anything is missing or malformed the server crashes immediately
 * with a human-readable error — no silent undefined values at runtime.
 */
const envSchema = z.object({
  // ── Server ──────────────────────────────────────────────
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(['dev', 'development', 'production', 'test']).default('dev'),
  CLIENT_URL: z.string().url().default('http://localhost:3000'),

  // ── Auth ────────────────────────────────────────────────
  JWT_SECRET: z.string().min(10, 'JWT_SECRET must be at least 10 characters'),
  SESSION_SECRET: z.string().min(10),

  // ── Database ────────────────────────────────────────────
  MONGODB_URI: z.string().url().or(z.string().startsWith('mongodb')),

  // ── Twilio (SMS Auth) ──────────────────────────────────
  TWILIO_ACCOUNT_SID: z.string().startsWith('AC'),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_VERIFY_SERVICE_SID: z.string().startsWith('VA'),

  // ── FatSecret ───────────────────────────────────────────
  FATSECRET_CLIENT_ID: z.string().min(1),
  FATSECRET_CLIENT_SECRET: z.string().min(1),

  // ── OpenAI ──────────────────────────────────────────────
  OPENAI_API_KEY: z.string().min(1),

  // ── Google Gemini / Imagen (optional — enable when billing is active)
  GEMINI_API_KEY: z.string().min(1).optional(),

  // ── OpenWeatherMap ──────────────────────────────────────
  OPENWEATHER_API_KEY: z.string().min(1),

  // ── API Ninjas (Exercise DB) ────────────────────────────
  API_NINJAS_KEY: z.string().min(1),

  // ── Cloudflare R2 (Object Storage) ─────────────────────
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
  CLOUDFLARE_API_KEY: z.string().min(1),
  CLOUDFLARE_ACCESS_KEY: z.string().min(1),
  CLOUDFLARE_SECRET_KEY: z.string().min(1),

  // ── Google OAuth ────────────────────────────────────────
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_CALLBACK_URL: z.string().url().or(z.string().startsWith('http')),

  // ── Email ───────────────────────────────────────────────
  EMAIL_PASSWORD: z.string().min(1),

  // ── Misc ────────────────────────────────────────────────
  CELEST_API_KEY: z.string().min(1),

  // ── Expo Push (optional — higher rate limits when set) ───
  EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌  Invalid environment variables:\n');
  for (const issue of parsed.error.issues) {
    console.error(`   ${issue.path.join('.')} — ${issue.message}`);
  }
  process.exit(1);
}

/**
 * Typed, validated environment config.
 * Import this instead of using `process.env` directly.
 */
export const env: Env = Object.freeze(parsed.data);

/** Convenience helper: true when NODE_ENV is 'production' */
export const isProd = env.NODE_ENV === 'production';

/** Convenience helper: true when NODE_ENV is 'dev' or 'development' */
export const isDev = env.NODE_ENV === 'dev' || env.NODE_ENV === 'development';
