import type { IUser } from '../models/User.js';

declare global {
  namespace Express {
    interface Request {
      /** Populated by the `protect()` middleware after JWT verification */
      user?: IUser;
    }
  }
}
