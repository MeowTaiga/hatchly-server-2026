/**
 * Apply crop growth times (wheat 30s, everything else ≥ 2m) and time-scaled
 * produce sell prices.
 *
 * Run: npm run rebalance:farming-economy
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { createLogger } from '../config/logger.js';
import { resolveCropGrowthMs } from '../constants/farmingCropGrowth.js';
import {
  produceSellPriceFromSeedBuy,
  seedSellPriceFromBuy,
} from '../constants/farmingLevelSeedShopUnlocks.js';
import { GameItemDef } from '../models/GameItemDef.js';

const log = createLogger('RebalanceFarmingEconomy');

async function main() {
  await connectDatabase();

  const seeds = await GameItemDef.find({ category: 'seed' });
  let growthUpdated = 0;
  let seedPriced = 0;
  let producePriced = 0;

  for (const seed of seeds) {
    const before = seed.harvestYield ?? [];
    const produceOnly = before.filter((d) => d.itemType !== seed.itemType);
    if (produceOnly.length !== before.length) {
      seed.harvestYield = produceOnly;
    }

    const nextGrowth = resolveCropGrowthMs(seed.itemType, seed.growthMs);
    if (seed.growthMs !== nextGrowth) {
      seed.growthMs = nextGrowth;
      growthUpdated += 1;
    }

    const buy = typeof seed.gemPrice === 'number' ? seed.gemPrice : 0;
    if (buy > 0) {
      const nextSell = seedSellPriceFromBuy(buy);
      if (seed.sellPrice !== nextSell) {
        seed.sellable = true;
        seed.sellPrice = nextSell;
        seedPriced += 1;
      }
    }

    await seed.save();

    if (buy <= 0 || seed.buyable === false) continue;
    const produceSell = produceSellPriceFromSeedBuy(buy, seed.growthMs ?? nextGrowth);
    const produceTypes = [...new Set(produceOnly.map((d) => d.itemType))];
    for (const itemType of produceTypes) {
      const produce = await GameItemDef.findOne({ itemType });
      if (!produce) {
        log.warn({ seed: seed.itemType, itemType }, 'Produce def missing');
        continue;
      }
      if (produce.sellPrice !== produceSell) {
        produce.sellable = true;
        produce.sellPrice = produceSell;
        await produce.save();
        producePriced += 1;
      }
    }
  }

  log.info(
    { growthUpdated, seedPriced, producePriced, seeds: seeds.length },
    'Farming growth and payouts rebalanced',
  );
  await disconnectDatabase();
}

main().catch((err) => {
  log.error({ err }, 'Rebalance failed');
  process.exit(1);
});
