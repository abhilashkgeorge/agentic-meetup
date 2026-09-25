/**
 * Write the briefs for a rendezvous that has already happened.
 *
 * FOR DEVELOPMENT, and it says so on the screen it produces. The brief path had never
 * once executed against real data -- seven pairs ran and every one of them lapsed, so
 * the code that picks overlapping quotes and writes the card was shipped unverified.
 * A path that only runs when a rare thing happens is a path that is broken.
 *
 * It does NOT fake a verdict. The rendezvous keeps the count it earned; this writes
 * the card the count would have produced, so the reveal, the decision and the
 * conversation can be exercised end to end.
 */
import { Pool } from 'pg';
import { env } from '../src/env.js';
import { close, closeMatchPool, matchmakerSession } from '../src/db/client.js';
import { cardFacts, composeBoth, loadQuotes, saveBriefs, type Quote } from '../src/matching/brief.js';
import { publicTags } from '../src/matching/rendezvous.js';

const email = process.argv[2];
if (!email) {
  console.error('usage: tsx scripts/brief-one.ts <email>');
  process.exit(1);
}

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const { rows: users } = await owner.query<{ id: string; tenant_id: string }>(
  'SELECT id, tenant_id FROM app_users WHERE email = $1', [email]);
const me = users[0];
if (!me) { console.error(`no such user: ${email}`); process.exit(1); }

// The best of the ones that ran, so the card is about the pair the agents liked most.
const { rows: pairs } = await owner.query<{
  id: string; user_a: string; user_b: string; tenant_a: string; tenant_b: string;
}>(
  `SELECT id, user_a, user_b, tenant_a, tenant_b FROM rendezvous
    WHERE (user_a = $1 OR user_b = $1) AND runs_done > 0
    ORDER BY both_yes DESC, decided_at DESC LIMIT 1`,
  [me.id],
);
const pair = pairs[0];
if (!pair) { console.error('no rendezvous has run yet'); process.exit(1); }

const a = { userId: pair.user_a, tenantId: pair.tenant_a };
const b = { userId: pair.user_b, tenantId: pair.tenant_b };

// Each person's verified sentences under their own session, as the round reads them
// (see loadQuotes); the brief itself is code and calls no model.
const [qa, qb] = [await loadQuotes(a), await loadQuotes(b)];
console.log(`quotes: ${qa.length} and ${qb.length}`);
const result = await matchmakerSession(async (c) => {
  const side = async (who: { userId: string }, quotes: Quote[]) =>
    ({ card: await cardFacts(c, who.userId), tags: await publicTags(c, who.userId), quotes });
  const briefs = composeBoth(await side(a, qa), await side(b, qb));
  const written = await saveBriefs(c, pair.id, a, b, briefs);
  await c.query(
    `UPDATE rendezvous SET status = 'decided', decided_at = coalesce(decided_at, now())
      WHERE id = $1`, [pair.id]);
  return { written, briefs };
});

console.log(JSON.stringify(result, null, 2));
await owner.end();
await closeMatchPool();
await close();
