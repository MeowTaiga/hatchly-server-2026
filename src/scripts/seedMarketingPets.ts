/**
 * Generate cute pet illustrations for the marketing site.
 * Uses the same `buildPetImagePrompt` + gpt-image-1-mini path as onboarding
 * (`POST /pets/generate`).
 *
 * Usage:
 *   npm run seed:marketing-pets
 *   npm run seed:marketing-pets -- --base-only      # registration-style base art only (no pose edit)
 *   npm run seed:marketing-pets -- --force          # regen base (+ pose unless --base-only)
 *   npm run seed:marketing-pets -- --poses-only     # keep base art, regen poses
 *   npm run seed:marketing-pets -- --fix-mouths     # edit existing art: simple closed smile only
 *   npm run seed:marketing-pets -- --batch=2        # only the second flock of 10
 */
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { createLogger } from '../config/logger.js';
import {
  ALL_PETS,
  LIGHT_COLORS,
  buildPetImagePrompt,
  type GeneratedPet,
} from '../constants/pets.js';
import { POSE_PROMPTS, type PetPose } from '../constants/petPoses.js';
import { MarketingPet } from '../models/MarketingPet.js';
import { openAIService } from '../services/OpenAIService.js';
import { storageService } from '../services/StorageService.js';

const log = createLogger('SeedMarketingPets');

/** First flock (includes some pose variants from earlier runs). */
const SHOWCASE_BATCH_1: Array<{ name: string; vibe: string }> = [
  { name: 'Bunny', vibe: 'Bouncy' },
  { name: 'Axolotl', vibe: 'Adorable' },
  { name: 'Capybara', vibe: 'Zen' },
  { name: 'Red Panda', vibe: 'Cozy' },
  { name: 'Star Bunny', vibe: 'Celestial' },
  { name: 'Unicorn', vibe: 'Dreamy' },
  { name: 'Baby Whale', vibe: 'Gentle Giant' },
  { name: 'Firefly', vibe: 'Glowing' },
  { name: 'Nebula Kitten', vibe: 'Swirling' },
  { name: 'Fox', vibe: 'Clever' },
];

/**
 * Second flock — cuddly / registration-friendly picks.
 * Generated as base-only (same happy chibi as signup).
 */
const SHOWCASE_BATCH_2: Array<{ name: string; vibe: string }> = [
  { name: 'Puppy', vibe: 'Friendly' },
  { name: 'Koala', vibe: 'Sleepy' },
  { name: 'Kitten', vibe: 'Soft' },
  { name: 'Fuzzy Otter', vibe: 'Snuggly' },
  { name: 'Penguin', vibe: 'Waddly' },
  { name: 'Mochi Cat', vibe: 'Squishy' },
  { name: 'Quokka', vibe: 'Smiley' },
  { name: 'Duckling', vibe: 'Quirky' },
  { name: 'Hamster', vibe: 'Tiny' },
  { name: 'Fennec Fox', vibe: 'Adorable' },
];

/** Fun poses for the landing page (skip sad/hungry for marketing vibes). */
const MARKETING_POSES: PetPose[] = [
  'happy',
  'wow',
  'sitting',
  'standing',
  'walking',
  'sleepy',
  'eating',
  'sleeping',
];

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      log.warn({ err, label, attempt: i }, 'Retrying after failure');
      await sleep(1500 * i);
    }
  }
  throw lastErr;
}

function pickPose(index: number, used: Set<string>): PetPose {
  for (let offset = 0; offset < MARKETING_POSES.length; offset++) {
    const pose = MARKETING_POSES[(index + offset) % MARKETING_POSES.length];
    if (!used.has(pose)) {
      used.add(pose);
      return pose;
    }
  }
  return MARKETING_POSES[index % MARKETING_POSES.length];
}

const MOUTH_FIX_PROMPT = `Edit this exact pet illustration. Keep the pet's body, pose, colors, outlines, eyes, ears, and blush EXACTLY identical.
Only fix the face mouth area:
- Remove any nose, w-shaped mouth, omega/ω mouth, cat muzzle, open mouth, tongue, teeth, red oval mouth, philtrum line, or floating face marks.
- Replace with ONE tiny simple closed smile: a single thin gentle upward curved black line (like ˘). Nothing else near it.
Do not change anything except the mouth/nose area.`;

async function fixMouthOnImage(imageUrl: string, slug: string): Promise<string> {
  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) {
    throw new Error(`Failed to fetch image (${imageRes.status})`);
  }
  const arrayBuffer = await imageRes.arrayBuffer();
  const refBase64 = Buffer.from(arrayBuffer).toString('base64');

  const dataUri = await openAIService.editImageBase64(refBase64, MOUTH_FIX_PROMPT, {
    size: '1024x1024',
    quality: 'medium',
    background: 'transparent',
    inputFidelity: 'high',
  });

  return storageService.uploadBase64(dataUri, `marketing/pets/${slug}`);
}

async function generatePoseFromBase(
  baseImageUrl: string,
  poseKey: PetPose,
  slug: string,
): Promise<string> {
  const imageRes = await fetch(baseImageUrl);
  if (!imageRes.ok) {
    throw new Error(`Failed to fetch base image (${imageRes.status})`);
  }
  const arrayBuffer = await imageRes.arrayBuffer();
  const refBase64 = Buffer.from(arrayBuffer).toString('base64');

  const posePrompt = POSE_PROMPTS[poseKey] ?? poseKey;
  // Same wrapper as POST /pets/generate-pose
  const prompt = `Recreate this exact pet character in a new pose. CRITICAL:
- Keep the pet's proportions, art style, colors, markings, and species EXACTLY identical.
- Preserve the black outlines and cel-shaded/cartoon line-art style — the reference has dark outlines around all features; your output MUST have the same black outlines.
- Only change the pose or expression to: ${posePrompt}.
The result must look like the same pet in the exact same art style, just in a different pose.`;

  const dataUri = await openAIService.editImageBase64(refBase64, prompt, {
    size: '1024x1024',
    quality: 'medium',
    background: 'transparent',
    inputFidelity: 'high',
  });

  return storageService.uploadBase64(dataUri, `marketing/pets/${slug}/poses`);
}

async function main() {
  const force = process.argv.includes('--force');
  const posesOnly = process.argv.includes('--poses-only');
  const baseOnly = process.argv.includes('--base-only');
  const fixMouths = process.argv.includes('--fix-mouths');
  const batchArg = process.argv.find((a) => a.startsWith('--batch='));
  const batch = batchArg ? Number(batchArg.split('=')[1]) : 0;

  const showcase =
    batch === 1
      ? SHOWCASE_BATCH_1
      : batch === 2
        ? SHOWCASE_BATCH_2
        : [...SHOWCASE_BATCH_1, ...SHOWCASE_BATCH_2];

  const sortOffset = batch === 2 ? SHOWCASE_BATCH_1.length : 0;

  await connectDatabase();

  log.info(
    {
      count: showcase.length,
      catalogSize: ALL_PETS.length,
      force,
      posesOnly,
      baseOnly,
      fixMouths,
      batch: batch || 'all',
    },
    'Seeding marketing pets',
  );

  let created = 0;
  let posed = 0;
  let skipped = 0;
  const usedPoses = new Set<string>();

  for (let i = 0; i < showcase.length; i++) {
    const pick = showcase[i];
    const def = ALL_PETS.find((p) => p.name === pick.name && p.vibe === pick.vibe);
    if (!def) {
      log.warn(pick, 'Pet not found in ALL_PETS catalog — skipping');
      skipped++;
      continue;
    }

    const slug = def.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const existing = await MarketingPet.findOne({ name: pick.name, vibe: pick.vibe });
    const poseKey = pickPose(i, usedPoses);

    if (fixMouths) {
      const sourceUrl = existing?.imageUrl || existing?.baseImageUrl;
      if (!sourceUrl) {
        log.warn(pick, 'No existing image to fix mouth on — skipping');
        skipped++;
        continue;
      }
      log.info({ name: pick.name }, 'Fixing mouth…');
      try {
        const fixedUrl = await withRetry(`mouth:${slug}`, () => fixMouthOnImage(sourceUrl, slug));
        await MarketingPet.findOneAndUpdate(
          { name: pick.name, vibe: pick.vibe },
          {
            imageUrl: fixedUrl,
            baseImageUrl: fixedUrl,
            poseKey: 'happy',
            sortOrder: sortOffset + i,
            active: true,
          },
          { upsert: true },
        );
        created++;
        log.info({ name: pick.name, url: fixedUrl }, 'Mouth fixed');
      } catch (err) {
        log.warn({ err, name: pick.name }, 'Mouth fix failed');
        skipped++;
      }
      await sleep(800);
      continue;
    }

    let baseImageUrl = existing?.baseImageUrl || existing?.imageUrl;

    if (!baseImageUrl || (force && !posesOnly)) {
      const color = LIGHT_COLORS[i % LIGHT_COLORS.length];
      const pet: GeneratedPet = {
        ...def,
        baseColor: color.base,
        secondaryColor: color.secondary,
      };

      log.info({ name: pet.name, vibe: pet.vibe }, 'Generating base image (onboarding prompt)…');
      const prompt = buildPetImagePrompt(pet);
      const imageDataUri = await openAIService.generateImageBase64(prompt, {
        model: 'gpt-image-1-mini',
      });
      baseImageUrl = await withRetry(`upload-base:${slug}`, () =>
        storageService.uploadBase64(imageDataUri, `marketing/pets/${slug}`),
      );
      created++;
      log.info({ name: pet.name, baseImageUrl }, 'Base image saved');
      await sleep(800);
    } else {
      log.info({ name: pick.name }, 'Reusing existing base image');
    }

    let imageUrl = existing?.imageUrl ?? baseImageUrl;
    let savedPoseKey = existing?.poseKey ?? 'happy';

    if (baseOnly) {
      // Registration / signup style — happy base chibi, no pose edit pass
      imageUrl = baseImageUrl!;
      savedPoseKey = 'happy';
      if (!existing || force) {
        log.info({ name: pick.name }, 'Base-only mode — using onboarding happy pose');
      } else {
        skipped++;
      }
    } else {
      const needsPose =
        force || posesOnly || !existing?.poseKey || existing.imageUrl === existing.baseImageUrl;

      if (needsPose || !existing?.poseKey) {
        log.info({ name: pick.name, poseKey }, 'Generating random pose…');
        try {
          imageUrl = await withRetry(`pose:${slug}:${poseKey}`, () =>
            generatePoseFromBase(baseImageUrl!, poseKey, slug),
          );
          savedPoseKey = poseKey;
          posed++;
          log.info({ name: pick.name, poseKey, imageUrl }, 'Pose saved');
        } catch (err) {
          log.warn({ err, name: pick.name, poseKey }, 'Pose gen failed — using base image');
          imageUrl = baseImageUrl!;
          savedPoseKey = 'base';
        }
        await sleep(1000);
      } else {
        skipped++;
        log.info({ name: pick.name, poseKey: existing.poseKey }, 'Pose already present — skip');
      }
    }

    const color = LIGHT_COLORS[i % LIGHT_COLORS.length];
    await MarketingPet.findOneAndUpdate(
      { name: pick.name, vibe: pick.vibe },
      {
        name: def.name,
        vibe: def.vibe,
        category: def.category,
        baseColor: existing?.baseColor ?? color.base,
        secondaryColor: existing?.secondaryColor ?? color.secondary,
        baseImageUrl,
        imageUrl,
        poseKey: savedPoseKey,
        sortOrder: sortOffset + i,
        active: true,
      },
      { upsert: true, returnDocument: 'after' },
    );
  }

  const active = await MarketingPet.find({ active: true }).sort({ sortOrder: 1 }).lean();
  log.info(
    {
      created,
      posed,
      skipped,
      total: active.length,
      flock: active.map((p) => ({ name: p.name, pose: p.poseKey, url: p.imageUrl })),
    },
    'Marketing pet seed complete',
  );

  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
