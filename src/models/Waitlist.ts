import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export type WaitlistStatus = 'pending' | 'notified' | 'converted';

export interface IWaitlist extends Document {
  email: string;
  joinedAt: Date;
  userAgent?: string;
  referrer?: string;
  ipAddress?: string;
  status: WaitlistStatus;
  source?: string;
  betaCohort?: string;
}

const waitlistSchema = new Schema<IWaitlist>({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  joinedAt: {
    type: Date,
    default: Date.now,
  },
  userAgent: { type: String },
  referrer: { type: String },
  ipAddress: { type: String },
  status: {
    type: String,
    enum: ['pending', 'notified', 'converted'],
    default: 'pending',
  },
  source: { type: String, default: 'marketing' },
  betaCohort: { type: String, default: '2026-09-21' },
});

waitlistSchema.plugin(basePlugin);

export const Waitlist = mongoose.model<IWaitlist>('Waitlist', waitlistSchema);
