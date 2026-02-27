import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export type UserQuestStatus = 'locked' | 'active' | 'completed';

export interface IUserQuest extends Document {
  userId: mongoose.Types.ObjectId;
  questId: string;
  status: UserQuestStatus;
  /** For multi-step quests: which step user is on. */
  currentStepId?: string;
  /** Tracked progress across requirement types. */
  progress: {
    actions: Map<string, number>;
    npcTalks?: Map<string, number>;
    cropsGrown?: Map<string, number>;
    modalsOpened?: Map<string, number>;
  };
  /** Whether the start dialog has been shown to the user. */
  startDialogShown: boolean;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userQuestSchema = new Schema<IUserQuest>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    questId: { type: String, required: true },
    status: { type: String, required: true, enum: ['locked', 'active', 'completed'], default: 'locked' },
    currentStepId: { type: String },
    progress: {
      actions: { type: Map, of: Number, default: {} },
      npcTalks: { type: Map, of: Number, default: undefined },
      cropsGrown: { type: Map, of: Number, default: undefined },
      modalsOpened: { type: Map, of: Number, default: undefined },
    },
    startDialogShown: { type: Boolean, default: false },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

userQuestSchema.index({ userId: 1, questId: 1 }, { unique: true });

userQuestSchema.plugin(basePlugin);

export const UserQuest = mongoose.model<IUserQuest>('UserQuest', userQuestSchema);
