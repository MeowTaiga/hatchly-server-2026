import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import hpp from 'hpp';
import { env, isDev } from '../config/env.js';

/**
 * Applies the full security middleware stack to the Express app in one call.
 *
 * Includes:
 * - `helmet` — sets common security HTTP headers
 * - `cors` — open in dev (Expo runs from device IPs), locked allowlist in prod
 * - `hpp` — protects against HTTP parameter pollution
 * - JSON body parser with 16 MB size limit (aligned with MongoDB BSON doc cap)
 * - URL-encoded body parser
 */
export function applySecurity(app: Express): void {
  // API is called cross-origin from hatchly.me — CORP must allow that.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
  );

  const allowedOrigins = new Set(
    [
      env.CLIENT_URL,
      env.MARKETING_URL,
      'https://hatchly.me',
      'https://www.hatchly.me',
      'http://localhost:5173',
      'http://localhost:4173',
      'http://127.0.0.1:5173',
    ].filter((origin): origin is string => Boolean(origin)),
  );

  app.use(
    cors({
      origin: isDev
        ? true
        : (origin, callback) => {
            // No Origin = same-origin / server-to-server — allow
            if (!origin || allowedOrigins.has(origin)) {
              callback(null, true);
              return;
            }
            // Important: callback(null, false) — do NOT throw, or OPTIONS returns 500
            // without Access-Control-Allow-Origin and browsers report a CORS failure.
            callback(null, false);
          },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      optionsSuccessStatus: 204,
    }),
  );

  app.use(hpp());
  // Scene editor saves send the full placements array in one PATCH; large scenes
  // need headroom up to Mongo's ~16MB document limit.
  app.use(express.json({ limit: '16mb' }));
  app.use(express.urlencoded({ extended: true, limit: '16mb' }));
}
