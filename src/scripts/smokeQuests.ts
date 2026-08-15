/**
 * End-to-end check of the quest flow over a real socket connection: load a
 * snapshot, talk to an NPC twice, and try to turn in a farm upgrade.
 *
 * Read-only unless a quest is genuinely completable, in which case it really
 * completes — point it at a test account.
 *
 * Run: npm run smoke:quests -- <userId> [npcItemType]
 */
import { io, type Socket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const userId = process.argv[2];
const npcItemType = process.argv[3] ?? 'cat_fisherman';
if (!userId) {
  console.error('Usage: npm run smoke:quests -- <userId> [npcItemType]');
  process.exit(1);
}

const token = jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: '1h' });
const url = `http://localhost:${env.PORT}`;

interface Quest {
  questId: string;
  type: string;
  status: string;
  farmLevel?: number;
  canComplete: boolean;
  gatesPass: boolean;
  clauses: { label: string; have: number; need: number; met: boolean }[];
}

function show(label: string, quests: Quest[] | undefined, extra: Record<string, unknown> = {}) {
  console.log(`\n── ${label} ──`);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) console.log(`  ${key}: ${JSON.stringify(value)}`);
  }
  for (const q of quests ?? []) {
    const checklist = q.clauses.map((c) => `${c.met ? '✓' : '·'} ${c.label} ${c.have}/${c.need}`).join(', ');
    const level = q.farmLevel ? ` →lv${q.farmLevel}` : '';
    console.log(
      `  [${q.status}]${level} ${q.questId}` +
        `${q.canComplete ? ' CAN COMPLETE' : ''}${q.status === 'locked' && q.gatesPass ? ' (gates pass)' : ''}` +
        (checklist ? `\n      ${checklist}` : ''),
    );
  }
}

/** Resolves on the next event of this name, or rejects if it never arrives. */
function next<T>(socket: Socket, event: string, ms = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function main() {
  const socket = io(url, { auth: { token }, transports: ['websocket'] });

  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  console.log('connected');

  socket.on('game:error', (e) => console.error('  game:error', e));

  const snapshotPromise = next<any>(socket, 'game:snapshot');
  socket.emit('game:load');
  const snapshot = await snapshotPromise;
  show('snapshot', snapshot.quests, {
    farmLevel: snapshot.farmLevel,
    farmXp: snapshot.farmXp,
    grid: `${snapshot.gridCols}x${snapshot.gridRows}`,
    canUpgrade: snapshot.canUpgrade,
    dialogs: snapshot.questDialogs?.map((d: any) => `${d.kind}:${d.questId || 'idle'}`),
  });

  // Talking should open any quest waiting on this NPC and return its lines.
  const talk = next<any>(socket, 'game:state_update');
  socket.emit('quest:talk_to_npc', { npcItemType });
  const afterTalk = await talk;
  show(`after talking to ${npcItemType}`, afterTalk.quests, {
    dialogs: afterTalk.questDialogs?.map((d: any) => `${d.kind}:${d.questId || 'idle'}`),
    completions: afterTalk.questCompletions?.map((c: any) => c.questId),
  });

  // A second tap must still answer, even with nothing new to say.
  const talkAgain = next<any>(socket, 'game:state_update');
  socket.emit('quest:talk_to_npc', { npcItemType });
  const afterTalkAgain = await talkAgain;
  show('talking again', undefined, {
    dialogs: afterTalkAgain.questDialogs?.map((d: any) => `${d.kind}:${d.questId || 'idle'}`) ?? 'none',
  });

  // Try the upgrade. Fails loudly when the checklist isn't met, which is the point.
  const upgrade = (afterTalk.quests ?? snapshot.quests).find(
    (q: Quest) => q.type === 'farm_upgrade' && q.status === 'active',
  );
  if (!upgrade) {
    console.log('\n  no active upgrade quest to try');
  } else {
    console.log(`\n  turning in ${upgrade.questId} (canComplete=${upgrade.canComplete})`);
    const result = Promise.race([
      next<any>(socket, 'game:snapshot', 5000).then((s) => ({ kind: 'snapshot', s })),
      next<any>(socket, 'game:error', 5000).then((e) => ({ kind: 'error', e })),
    ]);
    socket.emit('quest:complete', { questId: upgrade.questId });
    const outcome: any = await result.catch((err) => ({ kind: 'timeout', err }));

    if (outcome.kind === 'snapshot') {
      show('after upgrade', outcome.s.quests, {
        farmLevel: outcome.s.farmLevel,
        grid: `${outcome.s.gridCols}x${outcome.s.gridRows}`,
        gems: outcome.s.gems,
      });
    } else if (outcome.kind === 'error') {
      console.log(`  rejected: ${outcome.e.message}`);
    } else {
      console.log('  no response');
    }
  }

  socket.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('smoke test failed:', err);
  process.exit(1);
});
