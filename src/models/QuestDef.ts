import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';
import {
  DIALOG_HIGHLIGHT_TYPES,
  EQUIP_SLOTS,
  QUEST_TRIGGER_TYPES,
  QUEST_TYPES,
} from '../services/quests/constants.js';

export interface IQuestRequirement {
  /** Items the player must hold. Consumed on completion. */
  items?: { itemType: string; qty: number }[];
  /** Buildings that must be placed on the farm. Not consumed. */
  buildings?: { itemType: string; count: number }[];
  /** Cumulative action counts, tallied while the quest is active. */
  actions?: { action: string; count: number; itemType?: string }[];
  /** Gear that must be worn. A slot holds one item, so there is no count. */
  equips?: { slot: string; itemType?: string }[];
  /** Conversations finished with an NPC. */
  talk_to_npc?: { npcItemType: string; count?: number }[];
  /** Crops that reached harvestable. */
  crop_grown?: { itemType: string; count?: number }[];
  /** Modals or screens opened, keyed by an item's interact payload. */
  open_modal?: { payload: string; count?: number }[];
  /** Total farm XP the player must have reached. */
  farmXp?: number;
}

export interface IQuestReward {
  items?: { itemType: string; qty: number }[];
  gems?: number;
  xp?: number;
  /** Crafting recipe ids unlocked on completion (no scroll needed). */
  recipes?: string[];
}

export type QuestType = (typeof QUEST_TYPES)[number];

export type QuestTriggerType = (typeof QUEST_TRIGGER_TYPES)[number];

export interface IQuestTrigger {
  type: QuestTriggerType;
  /** For `quest_complete`. */
  questId?: string;
  /** For `talk_to_npc`. */
  npcItemType?: string;
  /** For `enter_scene`. */
  sceneSlug?: string;
  firstVisitOnly?: boolean;
}

export type DialogHighlightType = (typeof DIALOG_HIGHLIGHT_TYPES)[number];

export interface IDialogHighlight {
  type: DialogHighlightType;
  target: string;
}

export interface IDialogStep {
  text: string;
  highlight?: IDialogHighlight;
  /** When false the player can dismiss the line without satisfying the highlight. */
  blocking?: boolean;
  /** Overrides the dialog-level speaker for this line. */
  speaker?: 'pet' | 'npc';
}

export interface IQuestDef extends Document {
  questId: string;
  type: QuestType;
  title: string;
  description: string;
  /**
   * For `farm_upgrade` quests: the level this quest raises the farm to. The
   * quest becomes available when the farm is one level below it.
   */
  farmLevel?: number;
  /** Gates: the quest cannot open until these pass. */
  petLevelMin?: number;
  farmLevelMin?: number;
  requiredQuestId?: string;
  requirements: IQuestRequirement;
  rewards: IQuestReward;
  sortOrder: number;
  startDialog?: IDialogStep[];
  endDialog?: IDialogStep[];
  /**
   * Shown when the player taps the NPC while this quest is active but not
   * ready to turn in (open-book bubble). Custom reminder copy per quest.
   */
  progressDialog?: IDialogStep[];
  startDialogSpeaker?: 'pet' | 'npc';
  endDialogSpeaker?: 'pet' | 'npc';
  progressDialogSpeaker?: 'pet' | 'npc';
  /** How the quest opens. Empty is treated as `start`. */
  triggers?: IQuestTrigger[];
  createdAt: Date;
  updatedAt: Date;
}

const questRequirementSchema = new Schema<IQuestRequirement>(
  {
    items: [{ itemType: { type: String, required: true }, qty: { type: Number, required: true, min: 1 } }],
    buildings: [{ itemType: { type: String, required: true }, count: { type: Number, required: true, min: 1 } }],
    actions: [{
      action: { type: String, required: true },
      count: { type: Number, required: true, min: 1 },
      itemType: { type: String },
    }],
    equips: [{ slot: { type: String, required: true, enum: EQUIP_SLOTS }, itemType: { type: String } }],
    talk_to_npc: [{ npcItemType: { type: String, required: true }, count: { type: Number, default: 1, min: 1 } }],
    crop_grown: [{ itemType: { type: String, required: true }, count: { type: Number, default: 1, min: 1 } }],
    open_modal: [{ payload: { type: String, required: true }, count: { type: Number, default: 1, min: 1 } }],
    farmXp: { type: Number, min: 1 },
  },
  { _id: false },
);

const questRewardSchema = new Schema<IQuestReward>(
  {
    items: [{ itemType: { type: String, required: true }, qty: { type: Number, required: true, min: 1 } }],
    gems: { type: Number, min: 0 },
    xp: { type: Number, min: 0 },
    recipes: [{ type: String }],
  },
  { _id: false },
);

const dialogHighlightSchema = new Schema(
  {
    type: { type: String, required: true, enum: DIALOG_HIGHLIGHT_TYPES },
    target: { type: String, required: true },
  },
  { _id: false },
);

const dialogStepSchema = new Schema(
  {
    text: { type: String, required: true },
    highlight: { type: dialogHighlightSchema },
    blocking: { type: Boolean, default: true },
    speaker: { type: String, enum: ['pet', 'npc'] },
  },
  { _id: false },
);

const questDefSchema = new Schema<IQuestDef>(
  {
    questId: { type: String, required: true, unique: true, index: true },
    type: { type: String, required: true, enum: QUEST_TYPES },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    farmLevel: { type: Number },
    petLevelMin: { type: Number },
    farmLevelMin: { type: Number },
    requiredQuestId: { type: String },
    requirements: { type: questRequirementSchema, default: {} },
    rewards: { type: questRewardSchema, default: {} },
    sortOrder: { type: Number, default: 0 },
    startDialog: { type: [dialogStepSchema], default: undefined },
    endDialog: { type: [dialogStepSchema], default: undefined },
    progressDialog: { type: [dialogStepSchema], default: undefined },
    startDialogSpeaker: { type: String, enum: ['pet', 'npc'] },
    endDialogSpeaker: { type: String, enum: ['pet', 'npc'] },
    progressDialogSpeaker: { type: String, enum: ['pet', 'npc'] },
    triggers: [{
      type: { type: String, enum: QUEST_TRIGGER_TYPES },
      questId: { type: String },
      npcItemType: { type: String },
      sceneSlug: { type: String },
      firstVisitOnly: { type: Boolean },
    }],
  },
  { timestamps: true },
);

questDefSchema.plugin(basePlugin);

export const QuestDef = mongoose.model<IQuestDef>('QuestDef', questDefSchema);
