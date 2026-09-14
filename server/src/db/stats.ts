/** `npm run stats` -- the numbers the cost model is currently guessing at. */
import { adminSession, close } from './client.js';
import { cachingVerdict, intentRollup, usage7d } from '../metrics.js';

const u = await adminSession((c) => usage7d(c));
const intents = await adminSession((c) => intentRollup(c));
await close();

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
console.log(`
last 7 days
  active users              ${u.activeUsers}
  sessions                  ${u.sessions}
  turns/user/day            ${u.turnsPerActiveUserPerDay.toFixed(1)}
  median turns/session      ${u.medianTurnsPerSession.toFixed(1)}   <- caching model depends on this
  p90 turns/session         ${u.p90TurnsPerSession.toFixed(1)}
  single-turn sessions      ${pct(u.singleTurnSessionShare)}
  voice share of turns      ${pct(u.voiceShareOfTurns)}   <- voice OUTPUT is the cost cliff
  cache read ratio          ${pct(u.cacheReadRatio)}
  cost/user/day             $${u.costPerActiveUserPerDay.toFixed(4)}
  total spend               $${u.totalCostUsd.toFixed(4)}

  ${cachingVerdict(u)}
`);

if (intents.length) {
  console.log('what people use their clone for (90d)');
  for (const i of intents) {
    console.log(
      `  ${i.intent.padEnd(16)} ${String(i.users).padStart(4)} users  ` +
        `${String(i.sessions).padStart(5)} sessions  conf ${i.meanConfidence.toFixed(2)}`,
    );
  }
  console.log(`
  This decides which cluster to recruit when discovery switches on.
  One dense intent beats four thin ones.
`);
}
