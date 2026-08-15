/**
 * Apply farming-skill shop unlocks onto GameItemDef seed rows.
 * Sets buyable + farmingSkillLevel + default gemPrice; clears old farmLevel
 * gates on progression seeds. Does not touch reserved event/rare seeds.
 *
 * Run: npm run apply:farming-seed-shop
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { createLogger } from '../config/logger.js';
import {
  FARMING_RESERVED_EVENT_SEEDS,
  FARMING_SEED_SHOP_DEFAULT_PRICES,
  FARMING_STARTER_SHOP_SEEDS,
  allFarmingShopProgressionSeeds,
  farmingSkillLevelForShopSeed,
} from '../constants/farmingLevelSeedShopUnlocks.js';
import { GameItemDef } from '../models/GameItemDef.js';

const log = createLogger('ApplyFarmingSeedShop');

async function main() {
  await connectDatabase();

  const progression = allFarmingShopProgressionSeeds();
  let updated = 0;
  let missing = 0;

  for (const itemType of progression) {
    const existing = await GameItemDef.findOne({ itemType }).lean();
    if (!existing) {
      log.warn({ itemType }, 'Progression seed missing from GameItemDef');
      missing += 1;
      continue;
    }

    const skillLevel = farmingSkillLevelForShopSeed(itemType);
    const defaultPrice = FARMING_SEED_SHOP_DEFAULT_PRICES[itemType] ?? 5;
    const gemPrice =
      typeof existing.gemPrice === 'number' && existing.gemPrice > 0
        ? existing.gemPrice
        : defaultPrice;

    // Prefer balanced defaults when prior prices were wild (e.g. watermelon 300).
    const useDefault =
      !existing.buyable ||
      !existing.gemPrice ||
      existing.gemPrice <= 0 ||
      existing.gemPrice > defaultPrice * 4;
    const nextPrice = useDefault ? defaultPrice : gemPrice;

    await GameItemDef.updateOne(
      { itemType },
      {
        $set: {
          buyable: true,
          gemPrice: nextPrice,
          ...(skillLevel != null ? { farmingSkillLevel: skillLevel } : {}),
        },
        $unset: {
          farmLevel: 1,
          ...(skillLevel == null ? { farmingSkillLevel: 1 } : {}),
        },
      },
    );
    updated += 1;
  }

  // Keep reserved seeds out of the always-on shop.
  const reservedResult = await GameItemDef.updateMany(
    { itemType: { $in: [...FARMING_RESERVED_EVENT_SEEDS] } },
    {
      $set: { buyable: false },
      $unset: { farmingSkillLevel: 1, farmLevel: 1 },
    },
  );

  // Starter wheat: buyable, no skill gate.
  for (const itemType of FARMING_STARTER_SHOP_SEEDS) {
    await GameItemDef.updateOne(
      { itemType },
      {
        $set: {
          buyable: true,
          gemPrice: FARMING_SEED_SHOP_DEFAULT_PRICES[itemType] ?? 1,
        },
        $unset: { farmingSkillLevel: 1, farmLevel: 1 },
      },
    );
  }

  log.info(
    {
      progressionUpdated: updated,
      progressionMissing: missing,
      reservedCleared: reservedResult.modifiedCount,
    },
    'Farming seed shop unlocks applied',
  );

  await disconnectDatabase();
}

main().catch(async (err) => {
  log.error({ err }, 'Failed to apply farming seed shop unlocks');
  try {
    await disconnectDatabase();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
