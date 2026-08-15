/**
 * Wipes the quest data the old system left behind and writes each farm's level
 * down as a fact.
 *
 * Why the old data can't be kept: a quest's level lived in its id, and two
 * places parsed that id differently. `farm_upgrade_1` declared `farmLevel: 2`,
 * but the level check read the id's suffix and recorded 1 — so completing it
 * never granted level 2 and no farm ever grew. Progress counters were also keyed
 * against requirements that named items which don't exist (`soil_patch`), so
 * those quests could never finish either.
 *
 * This gives players the level their completed upgrade quests were supposed to
 * grant, then clears the quest state so it can be re-authored in the admin panel.
 *
 * Run: npx tsx src/scripts/resetQuests.ts [--keep-defs] [--dry-run]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Farm } from '../models/Farm.js';
import { QuestDef } from '../models/QuestDef.js';
import { UserQuest } from '../models/UserQuest.js';
import { UserProgress } from '../models/UserProgress.js';
import { FARM_LEVELS } from '../services/FarmService.js';

const MAX_LEVEL = FARM_LEVELS[FARM_LEVELS.length - 1].level;

/**
 * The level a completed upgrade quest was meant to grant. Prefers the quest's
 * own `farmLevel`; falls back to the id convention, where `farm_upgrade_N`
 * unlocked level N+1.
 */
function grantedLevel(questId: string, declared?: number): number | null {
  if (declared) return declared;
  const match = questId.match(/^farm_upgrade_(\d+)$/);
  return match ? Number(match[1]) + 1 : null;
}

async function run() {
  const keepDefs = process.argv.includes('--keep-defs');
  const dryRun = process.argv.includes('--dry-run');
  await connectDatabase();

  const upgradeDefs = await QuestDef.find({ type: 'farm_upgrade' }, { questId: 1, farmLevel: 1 }).lean();
  const declaredByQuest = new Map(upgradeDefs.map((d) => [d.questId, d.farmLevel]));

  const completedUpgrades = await UserQuest.find(
    { status: 'completed', questId: /^farm_upgrade/ },
    { userId: 1, questId: 1 },
  ).lean();

  const earnedByUser = new Map<string, number>();
  for (const row of completedUpgrades) {
    const level = grantedLevel(row.questId, declaredByQuest.get(row.questId));
    if (!level) continue;
    const userId = String(row.userId);
    earnedByUser.set(userId, Math.max(earnedByUser.get(userId) ?? 1, Math.min(level, MAX_LEVEL)));
  }

  const farms = await Farm.find({}, { userId: 1, xp: 1, farmLevel: 1 });
  let changed = 0;
  for (const farm of farms) {
    const level = earnedByUser.get(String(farm.userId)) ?? 1;
    if ((farm.farmLevel ?? 1) === level) continue;
    console.log(`  ${farm.userId}: level ${farm.farmLevel ?? 1} → ${level} (xp ${farm.xp})`);
    if (!dryRun) {
      farm.farmLevel = level;
      await farm.save();
    }
    changed++;
  }
  console.log(`  ${changed} of ${farms.length} farms re-levelled`);

  if (dryRun) {
    console.log(`\n  Dry run: would delete ${await UserQuest.countDocuments()} quest rows, ` +
      `${await UserProgress.countDocuments()} progress rows` +
      (keepDefs ? '' : `, ${await QuestDef.countDocuments()} definitions`));
    await disconnectDatabase();
    process.exit(0);
  }

  const quests = await UserQuest.deleteMany({});
  console.log(`  Deleted ${quests.deletedCount} player quest rows`);

  const progress = await UserProgress.deleteMany({});
  console.log(`  Deleted ${progress.deletedCount} player progress rows`);

  if (keepDefs) {
    console.log('  Kept quest definitions (--keep-defs)');
  } else {
    // Nothing here is worth restoring as-is, but keep a copy to author from.
    const all = await QuestDef.find().lean();
    const backupDir = resolve(process.cwd(), 'backups');
    const backupPath = resolve(backupDir, `questdefs-${Date.now()}.json`);
    await mkdir(backupDir, { recursive: true });
    await writeFile(backupPath, JSON.stringify(all, null, 2));
    console.log(`  Backed up ${all.length} definitions to ${backupPath}`);

    const defs = await QuestDef.deleteMany({});
    console.log(`  Deleted ${defs.deletedCount} quest definitions`);
    console.log('\n  Re-author quests in the admin panel. Farms keep the level they earned;');
    console.log('  authoring an upgrade quest for the next level lets them grow again.');
  }

  console.log('\nDone.');
  await disconnectDatabase();
  process.exit(0);
}

run().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
