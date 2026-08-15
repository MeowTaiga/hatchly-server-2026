/**
 * Generate N random pets using the same onboarding path:
 * buildPetImagePrompt + gpt-image-1-mini → R2 upload.
 *
 * Usage:
 *   npx tsx src/scripts/generateRandomPets.ts
 *   npx tsx src/scripts/generateRandomPets.ts --count=25
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { createLogger } from '../config/logger.js';
import {
  ALL_PETS,
  LIGHT_COLORS,
  buildPetImagePrompt,
  type GeneratedPet,
  type PetDefinition,
} from '../constants/pets.js';
import { openAIService } from '../services/OpenAIService.js';
import { storageService } from '../services/StorageService.js';

const log = createLogger('GenerateRandomPets');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Prefer diversity across categories, then fill randomly. */
function pickRandomDiverse(count: number): PetDefinition[] {
  const byCat = new Map<string, PetDefinition[]>();
  for (const pet of ALL_PETS) {
    const list = byCat.get(pet.category) ?? [];
    list.push(pet);
    byCat.set(pet.category, list);
  }

  const picked: PetDefinition[] = [];
  const used = new Set<string>();
  const categories = shuffle([...byCat.keys()]);

  // Round-robin one from each category first
  let guard = 0;
  while (picked.length < count && guard < count * 4) {
    guard++;
    for (const cat of categories) {
      if (picked.length >= count) break;
      const pool = shuffle(byCat.get(cat) ?? []).filter((p) => !used.has(`${p.name}|${p.vibe}`));
      if (!pool.length) continue;
      const pet = pool[0];
      used.add(`${pet.name}|${pet.vibe}`);
      picked.push(pet);
    }
  }

  // Fill remainder from full catalog
  if (picked.length < count) {
    for (const pet of shuffle(ALL_PETS)) {
      if (picked.length >= count) break;
      const key = `${pet.name}|${pet.vibe}`;
      if (used.has(key)) continue;
      used.add(key);
      picked.push(pet);
    }
  }

  return picked;
}

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
      await sleep(2000 * i);
    }
  }
  throw lastErr;
}

async function main() {
  const countArg = process.argv.find((a) => a.startsWith('--count='));
  const count = Math.min(100, Math.max(1, Number(countArg?.split('=')[1] ?? 25) || 25));

  await connectDatabase();

  const picks = pickRandomDiverse(count);
  const colors = shuffle([...LIGHT_COLORS]);

  log.info({ count: picks.length, catalog: ALL_PETS.length }, 'Generating random pets (onboarding path)');

  const results: Array<{
    name: string;
    vibe: string;
    category: string;
    baseColor: string;
    secondaryColor: string;
    imageUrl: string;
  }> = [];

  for (let i = 0; i < picks.length; i++) {
    const def = picks[i];
    const color = colors[i % colors.length];
    const pet: GeneratedPet = {
      ...def,
      baseColor: color.base,
      secondaryColor: color.secondary,
    };
    const slug = `${def.name}-${def.vibe}-${Date.now().toString(36)}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    log.info({ i: i + 1, total: picks.length, name: pet.name, vibe: pet.vibe, category: pet.category }, 'Generating…');

    try {
      const prompt = buildPetImagePrompt(pet);
      const imageDataUri = await withRetry(`gen:${slug}`, () =>
        openAIService.generateImageBase64(prompt, { model: 'gpt-image-1-mini' }),
      );
      const imageUrl = await withRetry(`upload:${slug}`, () =>
        storageService.uploadBase64(imageDataUri, `marketing/pets/random/${slug}`),
      );

      results.push({
        name: pet.name,
        vibe: pet.vibe,
        category: pet.category,
        baseColor: pet.baseColor,
        secondaryColor: pet.secondaryColor,
        imageUrl,
      });
      log.info({ name: pet.name, imageUrl }, 'Saved');
    } catch (err) {
      log.error({ err, name: pet.name }, 'Failed — skipping');
    }

    await sleep(900);
  }

  const outDir = path.resolve(__dirname, '../../../hatchly-marketing-2026/app-store-screenshots');
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'random-pets-25.json');
  const txtPath = path.join(outDir, 'random-pets-25.txt');

  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  fs.writeFileSync(
    txtPath,
    results.map((r, i) => `${i + 1}. ${r.name} (${r.vibe} · ${r.category})\n   ${r.imageUrl}`).join('\n\n') +
      '\n',
  );

  console.log('\n========== PET IMAGE LINKS ==========\n');
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`${i + 1}. ${r.name} — ${r.vibe} (${r.category})`);
    console.log(`   ${r.imageUrl}\n`);
  }
  console.log(`Wrote ${results.length} links to:\n  ${txtPath}\n  ${jsonPath}`);

  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
