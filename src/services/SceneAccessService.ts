import { Farm } from '../models/Farm.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { farmLevelOf } from './FarmService.js';

/**
 * Enforces interactAction.farmLevelMin for open_scene targets.
 * Looks up item defs that open this scene and requires the highest min.
 */
export async function assertCanEnterScene(userId: string, sceneSlug: string): Promise<void> {
  if (!sceneSlug || sceneSlug === 'farm') return;

  const gates = await GameItemDef.find({
    'interactAction.type': 'open_scene',
    'interactAction.payload': sceneSlug,
    'interactAction.farmLevelMin': { $gt: 0 },
  })
    .select('interactAction.farmLevelMin')
    .lean();

  if (gates.length === 0) return;

  const required = Math.max(
    ...gates.map((g) => g.interactAction?.farmLevelMin ?? 0),
  );
  if (required <= 0) return;

  const farm = await Farm.findOne({ userId }).select('farmLevel').lean();
  if (!farm) throw new Error('Farm not found');
  const level = farmLevelOf(farm).level;
  if (level < required) {
    throw new Error(`My farm needs to be level ${required} before I can go there…`);
  }
}
