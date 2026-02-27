import pino from 'pino';
import { env, isDev } from './env.js';

/**
 * Application-wide Pino logger.
 * Pretty-prints in dev, outputs structured JSON in production.
 * Import and use this everywhere — zero `console.log` in the codebase.
 */
export const logger = pino({
  level: isDev ? 'debug' : 'info',
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  }),
});

/**
 * Creates a child logger scoped to a specific module/service.
 * Usage: `const log = createLogger('TwilioService');`
 */
export const createLogger = (name: string) => logger.child({ module: name });
