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
 * - JSON body parser with 10 MB size limit
 * - URL-encoded body parser
 */
export function applySecurity(app: Express): void {
  app.use(helmet());

  app.use(
    cors({
      origin: isDev ? true : env.CLIENT_URL,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  app.use(hpp());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
}
