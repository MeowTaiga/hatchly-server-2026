/**
 * Seed dedicated goal-icon decorations when no good GameItemDef match exists.
 *
 *   npm run seed:goal-icons
 *   npm run seed:goal-icons -- --generate-images
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { createLogger } from '../config/logger.js';
import { GameItemDef } from '../models/GameItemDef.js';
import { openAIService } from '../services/OpenAIService.js';
import { storageService } from '../services/StorageService.js';

const log = createLogger('SeedGoalIcons');

const STYLE_FRAGMENT =
  `Art style: flat vector illustration with thick uniform black outlines, ` +
  `soft cel-shaded coloring with one highlight and one shadow tone per surface, no gradients. ` +
  `Perspective: front-facing view, similar to stardew valley, centered in frame. ` +
  `Proportions: slightly chunky and rounded for a friendly, cute aesthetic. ` +
  `Lighting: soft diffused light from the upper left, no drop shadow. ` +
  `Transparent PNG background, no ground plane, no extra props or decorations. ` +
  `The asset should fill roughly 95% of the image.`;

interface GoalIconSeed {
  itemType: string;
  label: string;
  color: string;
  promptSubject: string;
}

/** Weak or missing matches — walk (no shoe item) and stretch (no mat). */
const SEEDS: GoalIconSeed[] = [
  {
    itemType: 'walking_shoes',
    label: 'Walking Shoes',
    color: '#8D6E63',
    promptSubject:
      'a cute pair of cozy walking sneakers, side by side, simple farming-game shoe sprite',
  },
  {
    itemType: 'yoga_mat',
    label: 'Yoga Mat',
    color: '#81C784',
    promptSubject:
      'a rolled-up yoga mat with a small strap, cozy farming-game self-care prop sprite',
  },
];

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function generateImage(seed: GoalIconSeed): Promise<string> {
  const prompt = `A single ${seed.promptSubject}. ${STYLE_FRAGMENT}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const base64DataUri = await openAIService.generateImageBase64(prompt, {
        model: 'gpt-image-1',
        size: '1024x1024',
        quality: 'medium',
        background: 'transparent',
      });
      return await storageService.uploadBase64(base64DataUri, `game-items/${seed.itemType}`);
    } catch (err) {
      lastErr = err;
      log.warn({ err, itemType: seed.itemType, attempt }, 'Image generation failed; retrying');
      await sleep(2000 * attempt);
    }
  }
  throw lastErr;
}

async function main(): Promise<void> {
  const generateImages = process.argv.includes('--generate-images');
  const force = process.argv.includes('--force');
  await connectDatabase();

  let created = 0;
  let imaged = 0;

  for (const seed of SEEDS) {
    const existing = await GameItemDef.findOne({ itemType: seed.itemType });
    if (!existing) {
      await GameItemDef.create({
        itemType: seed.itemType,
        label: seed.label,
        emoji: '🌱',
        color: seed.color,
        category: 'decoration',
        placeable: true,
        cols: 1,
        rows: 1,
        sellable: true,
        sellPrice: 8,
        buyable: false,
        harvestYield: [],
        sortOrder: 900,
      });
      created += 1;
      log.info({ itemType: seed.itemType }, 'Created goal icon item');
    }

    const def = existing ?? (await GameItemDef.findOne({ itemType: seed.itemType }));
    if (!def) continue;
    if (!generateImages) continue;
    if (def.imageUrl && !force) {
      log.info({ itemType: seed.itemType }, 'imageUrl already set; skip');
      continue;
    }
    const imageUrl = await generateImage(seed);
    def.imageUrl = imageUrl;
    await def.save();
    imaged += 1;
    log.info({ itemType: seed.itemType, imageUrl }, 'Generated goal icon art');
  }

  log.info({ created, imaged, total: SEEDS.length }, 'Goal icon seed done');
  await disconnectDatabase();
}

main().catch((err) => {
  log.error({ err }, 'Goal icon seed failed');
  process.exit(1);
});
