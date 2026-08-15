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
 * - `cors` — open in dev (Expo runs from device IPs), locked to CLIENT_URL in prod
 * - `hpp` — protects against HTTP parameter pollution
 * - JSON body parser with 16 MB size limit (aligned with MongoDB BSON doc cap)
 * - URL-encoded body parser
 */
export function applySecurity(app: Express): void {
  app.use(helmet());

  const allowedOrigins = [env.CLIENT_URL, env.MARKETING_URL].filter(
    (origin): origin is string => Boolean(origin),
  );

  app.use(
    cors({
      origin: isDev
        ? true
        : (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
              callback(null, true);
              return;
            }
            callback(new Error(`CORS blocked for origin: ${origin}`));
          },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  app.use(hpp());
  // Scene editor saves send the full placements array in one PATCH; large scenes
  // need headroom up to Mongo's ~16MB document limit.
  app.use(express.json({ limit: '16mb' }));
  app.use(express.urlencoded({ extended: true, limit: '16mb' }));
}
