import type { Request, Response, NextFunction } from 'express';
import { type ZodObject, type ZodTypeAny, type ZodRawShape, ZodError } from 'zod';
import { AppError } from './errorHandler.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('Validate');

interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodObject<ZodRawShape>;
  params?: ZodObject<ZodRawShape>;
}

/**
 * Middleware factory that validates `req.body`, `req.query`, and/or `req.params`
 * against Zod schemas. Parsed (typed + stripped) values replace the raw ones so
 * downstream handlers receive clean data.
 *
 * @example
 * const schema = { body: z.object({ phone: z.string().min(10) }) };
 * router.post('/verify', validate(schema), handler);
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query);
        Object.defineProperty(req, 'query', {
          value: parsed as any,
          writable: true,
          configurable: true,
        });
      }
      if (schemas.params) {
        const parsed = schemas.params.parse(req.params);
        Object.defineProperty(req, 'params', {
          value: parsed as any,
          writable: true,
          configurable: true,
        });
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        }));

        log.warn({ details }, 'Validation failed');

        const error = new AppError('Validation failed', 400, 'VALIDATION_ERROR');
        error.details = details;
        return next(error);
      }
      next(err);
    }
  };
}
