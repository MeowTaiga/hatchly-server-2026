import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

// ─── Interface ─────────────────────────────────────────────────────────────────

export interface IOnboardingProfile extends Document {
  /** Reference to the user who owns this profile */
  userId: mongoose.Types.ObjectId;
  /** Display name entered during onboarding */
  displayName: string;
  /** Selected personality vibe (e.g. "Chill", "Energetic") */
  personalityVibe: string;
  /** Selected companion style (e.g. "Cheerleader", "Coach") */
  companionStyle: string;
  gender: string;
  birthday: string;
  heightFeet: number;
  heightInches: number;
  currentWeight: number;
  goalWeight: number;
  activityLevel: string;
  goals: string[];
  dietary: string[];
  /** Last onboarding step the user completed (route-based, e.g. "gender") */
  lastStep: string;
  /** Timestamp of when lastStep was recorded */
  lastStepAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Schema ────────────────────────────────────────────────────────────────────

const onboardingProfileSchema = new Schema<IOnboardingProfile>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  },
  displayName: { type: String, default: '' },
  personalityVibe: { type: String, default: '' },
  companionStyle: { type: String, default: '' },
  gender: { type: String, default: '' },
  birthday: { type: String, default: '' },
  heightFeet: { type: Number, default: 0 },
  heightInches: { type: Number, default: 0 },
  currentWeight: { type: Number, default: 0 },
  goalWeight: { type: Number, default: 0 },
  activityLevel: { type: String, default: '' },
  goals: [{ type: String }],
  dietary: [{ type: String }],
  lastStep: { type: String, default: '' },
  lastStepAt: { type: Date },
});

onboardingProfileSchema.plugin(basePlugin);

// ─── Model ─────────────────────────────────────────────────────────────────────

export const OnboardingProfile = mongoose.model<IOnboardingProfile>(
  'OnboardingProfile',
  onboardingProfileSchema,
);
