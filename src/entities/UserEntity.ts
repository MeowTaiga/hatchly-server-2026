import { User, type IUser } from '../models/User.js';
import { Subscription } from '../models/Subscription.js';
import { signJwt } from '../utils/token.js';
import { formatE164 } from '../utils/phone.js';
import { AppError } from '../middleware/errorHandler.js';

/** Sanitised pet sub-object included in API responses */
export interface PublicPet {
  name: string;
  customName: string;
  vibe: string;
  category: string;
  imageUrl: string;
  pose?: Record<string, string>;
  level: number;
  xp: number;
  xpToNextLevel: number;
}

/** Subscription summary included in API responses */
export interface PublicSubscription {
  status: string;
  plan: string;
  currentPeriodEnd: Date;
  trialEnd: Date | null;
}

/** Sanitised user object safe to send over the wire */
export interface PublicUser {
  id: string;
  phone: string;
  username?: string;
  role: string;
  lastLogin: Date;
  createdAt: Date;
  onboardingComplete: boolean;
  theme: 'light' | 'dark';
  accentColor?: string;
  pet?: PublicPet;
  subscription?: PublicSubscription | null;
}

/**
 * Entity wrapper around the User Mongoose document.
 *
 * Encapsulates all user-related business logic in a class so
 * controllers never make raw Mongoose calls.
 *
 * @example
 * const user = await UserEntity.findOrCreateByPhone('+15551234567');
 * const { token, user: publicUser } = await user.login();
 */
export class UserEntity {
  private doc: IUser;

  private constructor(doc: IUser) {
    this.doc = doc;
  }

  // ─── Static factories ──────────────────────────────────────────────────────

  /** Wrap an existing Mongoose document */
  static fromDoc(doc: IUser): UserEntity {
    return new UserEntity(doc);
  }

  /** Load a user from the database by their ObjectId */
  static async fromId(id: string): Promise<UserEntity> {
    const doc = await User.findById(id);
    if (!doc) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    return new UserEntity(doc);
  }

  /**
   * Core auth flow helper — looks up a user by phone number.
   * If the phone doesn't exist yet a brand-new user is created.
   *
   * @param rawPhone — any format, will be normalised to E.164
   * @returns `{ entity, isNewUser }` so the caller knows if onboarding is needed
   */
  static async findOrCreateByPhone(rawPhone: string): Promise<{ entity: UserEntity; isNewUser: boolean }> {
    const phone = formatE164(rawPhone);

    let doc = await User.findOne({ phone });

    if (doc) {
      return { entity: new UserEntity(doc), isNewUser: false };
    }

    doc = await User.create({ phone });
    return { entity: new UserEntity(doc), isNewUser: true };
  }

  // ─── Instance methods ──────────────────────────────────────────────────────

  /**
   * Generates a fresh JWT, updates `lastLogin`, and returns the token
   * alongside the public user profile (including subscription status).
   */
  async login(): Promise<{ token: string; user: PublicUser }> {
    this.doc.lastLogin = new Date();
    await this.doc.save();

    const token = signJwt({ userId: this.doc._id.toString() });
    return { token, user: await this.toPublic() };
  }

  /** Returns a sanitised user object with no internal Mongoose fields */
  async toPublic(): Promise<PublicUser> {
    const pet = this.doc.pet
      ? {
          name: this.doc.pet.name,
          customName: this.doc.pet.customName,
          vibe: this.doc.pet.vibe,
          category: this.doc.pet.category,
          imageUrl: this.doc.pet.imageUrl,
          pose: this.doc.pet.pose,
          hunger: this.doc.pet.hunger ?? 100,
          happy: this.doc.pet.happy ?? 100,
          mood: this.doc.pet.mood ?? 100,
          level: this.doc.pet.level,
          xp: this.doc.pet.xp,
          xpToNextLevel: this.doc.pet.xpToNextLevel,
        }
      : undefined;

    // Fetch subscription status
    const sub = await Subscription.findOne({ userId: this.doc._id });
    const subscription = sub
      ? {
          status: sub.status,
          plan: sub.plan,
          currentPeriodEnd: sub.currentPeriodEnd,
          trialEnd: sub.trialEnd,
        }
      : null;

    return {
      id: this.doc._id.toString(),
      phone: this.doc.phone,
      username: this.doc.username,
      role: this.doc.role,
      lastLogin: this.doc.lastLogin,
      createdAt: this.doc.createdAt,
      onboardingComplete: this.doc.onboardingComplete,
      theme: (this.doc.theme ?? 'light') as 'light' | 'dark',
      accentColor: this.doc.accentColor ?? undefined,
      pet,
      subscription,
    };
  }

  // ─── Accessors ─────────────────────────────────────────────────────────────

  get id(): string {
    return this.doc._id.toString();
  }

  get document(): IUser {
    return this.doc;
  }
}
