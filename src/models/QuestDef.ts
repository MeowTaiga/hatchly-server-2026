import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

export interface IQuestRequirement {
  /** Items consumed on quest completion. */
  items?: { itemType: string; qty: number }[];
  /** Buildings that must be placed on the farm (not consumed). */
  buildings?: { itemType: string; count: number }[];
  /** Cumulative action counts tracked while quest is active. Optional itemType for item-specific tracking. */
  actions?: { action: string; count: number; itemType?: string }[];
  /** Equipment that must be equipped (slot + optional itemType filter). */
  equips?: { slot: string; itemType?: string; count?: number }[];
  /** Talk to NPC (counted when user finishes NPC dialog). */
  talk_to_npc?: { npcItemType: string; count?: number }[];
  /** Crop reached harvestable state. */
  crop_grown?: { itemType: string; count?: number }[];
  /** User opened modal (e.g. cooking, crafting). */
  open_modal?: { payload: string; count?: number }[];
}

export interface IQuestReward {
  items?: { itemType: string; qty: number }[];
  gems?: number;
  xp?: number;
}

export type QuestType = 'farm_upgrade' | 'story' | 'daily';

export type QuestTriggerType = 'quest_complete' | 'talk_to_npc' | 'enter_scene' | 'manual' | 'start';

export interface IQuestTrigger {
  type: QuestTriggerType;
  questId?: string;
  npcItemType?: string;
  sceneSlug?: string;
  firstVisitOnly?: boolean;
}

export type DialogHighlightType = 'hud_button' | 'inventory_item' | 'world_item' | 'category_chip' | 'shop_item' | 'shop_category';

export interface IDialogHighlight {
  type: DialogHighlightType;
  target: string;
}

export interface IDialogStep {
  text: string;
  highlight?: IDialogHighlight;
  /** If false, user can dismiss dialog without completing highlight. */
  blocking?: boolean;
  /** Override speaker for this step: 'pet' | 'npc'. Falls back to dialog-level speaker if unset. */
  speaker?: 'pet' | 'npc';
}

export interface IQuestStep {
  stepId: string;
  requirements: IQuestRequirement;
  /** Dialog shown when step becomes active. */
  dialogBefore?: IDialogStep[];
  /** Dialog shown when step completes. */
  dialogAfter?: IDialogStep[];
  /** If false, user can dismiss dialog; step continues in background. */
  blocking?: boolean;
  /** Optional per-step rewards. */
  rewards?: IQuestReward;
  /** Explicit next step; if omitted, next is by array order. */
  nextStepId?: string;
}

export interface IQuestDef extends Document {
  questId: string;
  type: QuestType;
  title: string;
  description: string;
  /** For farm_upgrade quests: which farm level this unlocks. */
  farmLevel?: number;
  /** Minimum pet level required to activate this quest. */
  petLevelMin?: number;
  /** Minimum farm level required to activate this quest. */
  farmLevelMin?: number;
  /** Quest that must be completed before this quest can be activated. */
  requiredQuestId?: string;
  requirements: IQuestRequirement;
  rewards: IQuestReward;
  sortOrder: number;
  /** Dialog steps shown when this quest becomes active. */
  startDialog?: IDialogStep[];
  /** Dialog steps shown after this quest is completed. */
  endDialog?: IDialogStep[];
  /** Speaker for start dialog when talk_to_npc trigger: 'pet' | 'npc'. Default 'npc'. */
  startDialogSpeaker?: 'pet' | 'npc';
  /** Speaker for end dialog when talk_to_npc in requirements: 'pet' | 'npc'. Default 'npc'. */
  endDialogSpeaker?: 'pet' | 'npc';
  /** questId of the next quest to auto-activate on completion. @deprecated Use triggers instead. */
  autoTrigger?: string;
  /** Modular triggers: quest can be activated by any of these. */
  triggers?: IQuestTrigger[];
  /** Multi-step quest flow. If present, requirements per step; else use top-level requirements (legacy). */
  steps?: IQuestStep[];
  createdAt: Date;
  updatedAt: Date;
}

const questRequirementSchema = new Schema<IQuestRequirement>(
  {
    items: [{ itemType: { type: String, required: true }, qty: { type: Number, required: true, min: 1 } }],
    buildings: [{ itemType: { type: String, required: true }, count: { type: Number, required: true, min: 1 } }],
    actions: [{ action: { type: String, required: true }, count: { type: Number, required: true, min: 1 }, itemType: { type: String } }],
    equips: [{ slot: { type: String, required: true }, itemType: { type: String }, count: { type: Number, default: 1, min: 1 } }],
    talk_to_npc: [{ npcItemType: { type: String, required: true }, count: { type: Number, default: 1, min: 1 } }],
    crop_grown: [{ itemType: { type: String, required: true }, count: { type: Number, default: 1, min: 1 } }],
    open_modal: [{ payload: { type: String, required: true }, count: { type: Number, default: 1, min: 1 } }],
  },
  { _id: false },
);

const questRewardSchema = new Schema<IQuestReward>(
  {
    items: [{ itemType: { type: String, required: true }, qty: { type: Number, required: true, min: 1 } }],
    gems: { type: Number, min: 0 },
    xp: { type: Number, min: 0 },
  },
  { _id: false },
);

const dialogHighlightSchema = new Schema(
  {
    type: { type: String, required: true, enum: ['hud_button', 'inventory_item', 'world_item', 'category_chip', 'shop_item', 'shop_category'] },
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

const questStepSchema = new Schema(
  {
    stepId: { type: String, required: true },
    requirements: { type: questRequirementSchema, default: {} },
    dialogBefore: { type: [dialogStepSchema], default: undefined },
    dialogAfter: { type: [dialogStepSchema], default: undefined },
    blocking: { type: Boolean, default: true },
    rewards: { type: questRewardSchema, default: undefined },
    nextStepId: { type: String },
  },
  { _id: false },
);

const questDefSchema = new Schema<IQuestDef>(
  {
    questId: { type: String, required: true, unique: true, index: true },
    type: { type: String, required: true, enum: ['farm_upgrade', 'story', 'daily'] },
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
    startDialogSpeaker: { type: String, enum: ['pet', 'npc'] },
    endDialogSpeaker: { type: String, enum: ['pet', 'npc'] },
    autoTrigger: { type: String },
    triggers: [{
      type: { type: String, enum: ['quest_complete', 'talk_to_npc', 'enter_scene', 'manual', 'start'] },
      questId: { type: String },
      npcItemType: { type: String },
      sceneSlug: { type: String },
      firstVisitOnly: { type: Boolean },
    }],
    steps: { type: [questStepSchema], default: undefined },
  },
  { timestamps: true },
);

questDefSchema.plugin(basePlugin);

export const QuestDef = mongoose.model<IQuestDef>('QuestDef', questDefSchema);
