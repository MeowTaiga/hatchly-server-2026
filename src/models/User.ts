import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

// ─── Pet Sub-Document ─────────────────────────────────────────────────────────

export interface IUserPet {
  /** Species display name (e.g. "Calico Cat") */
  name: string;
  /** User-chosen nickname (e.g. "Buddy") */
  customName: string;
  /** Short personality tag (e.g. "Cozy") */
  vibe: string;
  /** Pet category (cute, cool, fierce, mythic, buggy, aquatic, cosmic) */
  category: string;
  /** Whether this is a special / rare pet */
  special: boolean;
  /** Primary colour hex */
  baseColor: string;
  /** Secondary colour hex */
  secondaryColor: string;
  /** Public R2 URL for the pet's generated image */
  imageUrl: string;
  /** Pose-specific images: { sleeping: url, sitting: url, ... } — used by game to show context-appropriate sprite */
  pose?: Record<string, string>;
  /** 0–100. Low = hungry; affects pose when < 50. */
  hunger: number;
  /** 0–100. Affects bubble emoji. */
  happy: number;
  /** 0–100. Sours (decreases) when over-petted. */
  mood: number;
  /**
   * Average skill level (floor of mean of all skill levels). Synced by SkillXpService.
   * Replaces the old care-only pet level.
   */
  level: number;
  /** @deprecated Unused — kept for older clients. Always 0. */
  xp: number;
  /** @deprecated Unused — kept for older clients. Always 1. */
  xpToNextLevel: number;
}

/** Per-skill progress (power-curve levels, OSRS-style). */
export interface ISkillProgress {
  level: number;
  /** XP toward the next level */
  xp: number;
}

export type IUserSkills = {
  farming: ISkillProgress;
  fishing: ISkillProgress;
  cooking: ISkillProgress;
  crafting: ISkillProgress;
  mining: ISkillProgress;
  social: ISkillProgress;
  health: ISkillProgress;
};

// ─── Interface ─────────────────────────────────────────────────────────────────

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  /** Mongoose's `id` virtual. Declared because routes read it off `req.user`. */
  id: string;
  /** E.164 phone number — the user's primary identity and login credential */
  phone: string;
  /** Optional display name, typically set during onboarding */
  username?: string;
  /** Authorization level */
  role: 'user' | 'admin' | 'superadmin';
  /** Last time the user obtained a fresh JWT */
  lastLogin: Date;
  /** Account status — suspended users are blocked from all endpoints */
  status: 'active' | 'suspended';
  /** The user's chosen pet, populated after onboarding pet selection */
  pet?: IUserPet;
  /** Per-activity skill levels (farming, fishing, …). */
  skills?: IUserSkills;
  /** Whether the user has completed the onboarding flow */
  onboardingComplete: boolean;
  /** UI theme preference (light / dark) — account setting */
  theme: 'light' | 'dark';
  /** Accent color hex (e.g. #FF6B9D) — account setting */
  accentColor?: string;
  /** IANA timezone string sent by the client (e.g. 'America/New_York') */
  timezone?: string;
  /** Managed by Mongoose timestamps plugin */
  createdAt: Date;
  updatedAt: Date;
}

// ─── Schema ────────────────────────────────────────────────────────────────────

const petSchema = new Schema<IUserPet>(
  {
    name: { type: String, required: true },
    customName: { type: String, required: true },
    vibe: { type: String, required: true },
    category: { type: String, required: true },
    special: { type: Boolean, default: false },
    baseColor: { type: String, required: true },
    secondaryColor: { type: String, required: true },
    imageUrl: { type: String, required: true },
    pose: { type: Schema.Types.Mixed, default: undefined }, // { sleeping: url, sitting: url, ... }
    hunger: { type: Number, default: 100, min: 0, max: 100 },
    happy: { type: Number, default: 100, min: 0, max: 100 },
    mood: { type: Number, default: 100, min: 0, max: 100 },
    level: { type: Number, default: 0 },
    xp: { type: Number, default: 0 },
    xpToNextLevel: { type: Number, default: 1 },
  },
  { _id: false },
);

const skillProgressSchema = new Schema<ISkillProgress>(
  {
    level: { type: Number, default: 0, min: 0, max: 99 },
    xp: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const skillsSchema = new Schema(
  {
    farming: { type: skillProgressSchema, default: () => ({ level: 0, xp: 0 }) },
    fishing: { type: skillProgressSchema, default: () => ({ level: 0, xp: 0 }) },
    cooking: { type: skillProgressSchema, default: () => ({ level: 0, xp: 0 }) },
    crafting: { type: skillProgressSchema, default: () => ({ level: 0, xp: 0 }) },
    mining: { type: skillProgressSchema, default: () => ({ level: 0, xp: 0 }) },
    social: { type: skillProgressSchema, default: () => ({ level: 0, xp: 0 }) },
    health: { type: skillProgressSchema, default: () => ({ level: 0, xp: 0 }) },
  },
  { _id: false },
);

const userSchema = new Schema<IUser>({
  phone: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  username: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'superadmin'],
    default: 'user',
  },
  lastLogin: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    enum: ['active', 'suspended'],
    default: 'active',
  },
  pet: {
    type: petSchema,
    default: undefined,
  },
  skills: {
    type: skillsSchema,
    default: undefined,
  },
  onboardingComplete: {
    type: Boolean,
    default: false,
  },
  theme: {
    type: String,
    enum: ['light', 'dark'],
    default: 'light',
  },
  accentColor: {
    type: String,
    default: undefined,
  },
  timezone: {
    type: String,
    default: undefined,
  },
});

userSchema.plugin(basePlugin);

// ─── Model ─────────────────────────────────────────────────────────────────────

export const User = mongoose.model<IUser>('User', userSchema);
