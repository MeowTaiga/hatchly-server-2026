/**
 * One-time migration: Replace fishingPole and bugNet with handTool.
 * - equipped.handTool = equipped.fishingPole ?? equipped.bugNet
 * - Remove equipped.fishingPole and equipped.bugNet
 *
 * Run: npx tsx src/scripts/migrateEquipHandTool.ts
 */
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Farm } from '../models/Farm.js';

async function migrate() {
  await connectDatabase();

  const farms = await Farm.find({
    $or: [{ 'equipped.fishingPole': { $exists: true } }, { 'equipped.bugNet': { $exists: true } }],
  })
    .select('userId equipped')
    .lean();

  let updated = 0;
  for (const f of farms) {
    const eq = f.equipped as { fishingPole?: string; bugNet?: string; handTool?: string } | undefined;
    if (!eq) continue;
    const handTool = eq.fishingPole ?? eq.bugNet;
    if (!handTool) continue;

    await Farm.updateOne(
      { userId: f.userId },
      {
        $set: { 'equipped.handTool': handTool },
        $unset: { 'equipped.fishingPole': '', 'equipped.bugNet': '' },
      },
    );
    updated++;
  }

  console.log(`Migrated ${updated} farms: fishingPole/bugNet -> handTool`);
  console.log('\nMigration complete.');
  await disconnectDatabase();
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
