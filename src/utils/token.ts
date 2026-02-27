import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/** Shape of the data stored inside every JWT we issue */
export interface JwtPayload {
  userId: string;
}

const JWT_EXPIRY = '30d';

/**
 * Signs a JWT containing the given payload.
 * Uses the validated `env.JWT_SECRET` — never a fallback string.
 */
export function signJwt(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

/**
 * Verifies and decodes a JWT.
 * Throws if the token is expired, malformed, or the signature is invalid.
 */
export function verifyJwt(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}
