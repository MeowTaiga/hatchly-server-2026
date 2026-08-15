import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

const MAX_MESSAGES = 100;

export interface IPetChatSuggest {
  component: string;
  content: string;
  title: string;
}

export interface IPetChatGoalCardGoal {
  id: string;
  title: string;
  notes?: string;
  iconItemType: string;
  iconImageUrl?: string;
  iconEmoji?: string;
  repeat: 'daily' | 'weekdays' | 'once';
  repeatDays: number[];
  remindAt?: string;
  dueToday: boolean;
  completedToday: boolean;
}

export interface IPetChatGoalCard {
  kind: 'created' | 'complete';
  alreadyExisted?: boolean;
  goal: IPetChatGoalCardGoal;
}

export interface IPetChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  suggest?: IPetChatSuggest;
  goalCards?: IPetChatGoalCard[];
}

export interface IPetChat extends Document {
  userId: mongoose.Types.ObjectId;
  messages: IPetChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const suggestSchema = new Schema<IPetChatSuggest>(
  {
    component: { type: String, required: true },
    content: { type: String, required: true },
    title: { type: String, required: true },
  },
  { _id: false },
);

const goalCardGoalSchema = new Schema<IPetChatGoalCardGoal>(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    notes: { type: String },
    iconItemType: { type: String, required: true },
    iconImageUrl: { type: String },
    iconEmoji: { type: String },
    repeat: { type: String, enum: ['daily', 'weekdays', 'once'], required: true },
    repeatDays: { type: [Number], default: [] },
    remindAt: { type: String },
    dueToday: { type: Boolean, required: true },
    completedToday: { type: Boolean, required: true },
  },
  { _id: false },
);

const goalCardSchema = new Schema<IPetChatGoalCard>(
  {
    kind: { type: String, enum: ['created', 'complete'], required: true },
    alreadyExisted: { type: Boolean },
    goal: { type: goalCardGoalSchema, required: true },
  },
  { _id: false },
);

const messageSchema = new Schema<IPetChatMessage>(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    suggest: { type: suggestSchema, default: undefined },
    goalCards: { type: [goalCardSchema], default: undefined },
  },
  { _id: true },
);

const petChatSchema = new Schema<IPetChat>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    messages: {
      type: [messageSchema],
      default: [],
    },
  },
  { timestamps: true },
);

petChatSchema.plugin(basePlugin);

petChatSchema.index({ userId: 1 }, { unique: true });

export const PetChat = mongoose.model<IPetChat>('PetChat', petChatSchema);
export { MAX_MESSAGES };
