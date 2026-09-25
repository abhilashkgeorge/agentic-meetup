/**
 * Put one account into a state worth walking through on a phone.
 *
 * FOR DOGFOODING, and it does not fake anything the product would not do: the agents
 * really ran, the briefs are really written by the brief path, and the invented person
 * really says yes because an invented person cannot open the app. What it does is
 * arrange for one card to be sitting there unanswered, so the reveal, the decision and
 * the conversation can be walked end to end without waiting for a pair to pass.
 *
 * The photos it gives the invented people are ABSTRACT — a colour and an initial, not
 * a face. Putting invented faces on invented people would make every screenshot a lie
 * about who is on the app, and the point of the pool is to test the machinery.
 */
import { Pool } from 'pg';
import sharp from 'sharp';
import { env } from '../src/env.js';
import { close, closeMatchPool, matchmakerSession, tenantSession } from '../src/db/client.js';
import { cardFacts, composeBoth, loadQuotes, saveBriefs, type Quote } from '../src/matching/brief.js';
import { publicTags } from '../src/matching/rendezvous.js';
import { autoDecideSynthetic } from '../src/matching/orchestrator.js';
import * as photos from '../src/photos/store.js';

const email = process.argv[2] ?? 'abhilash@dabba.com';
const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

const { rows: users } = await owner.query<{ id: string }>(
  'SELECT id FROM app_users WHERE email = $1', [email]);
const me = users[0];
if (!me) { console.error(`no such user: ${email}`); process.exit(1); }

/**
 * A flat colour with an initial on it. Obviously not a photograph, on purpose.
 *
 * LAID OUT FOR TWO CROPS, because the same file is served as both. The conversations
 * list shows it as a CIRCLE and the reveal shows the whole portrait, and the first
 * version ignored that: at 900x1200 a square thumbnail keeps the middle 900x900, so
 * the name sat exactly on the circle's bottom edge and came out as an unreadable
 * smudge under every avatar. The light disc, centred at y=470, was also 130px above
 * the crop's centre, so the thumbnail looked off-balance.
 *
 *   SAFE FOR THE THUMBNAIL   y in [150, 1050]   -- the centre square
 *   PORTRAIT ONLY            y < 150 or > 1050  -- cropped away in the circle
 *
 * So the disc and the initial are centred on y=600 and nothing else goes near them;
 * the name and the label sit below y=1080, where the circle cannot reach them and the
 * full portrait still shows them.
 */
async function placeholder(name: string, seed: number): Promise<Buffer> {
  const hue = (seed * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">
    <rect width="900" height="1200" fill="hsl(${hue},42%,62%)"/>
    <circle cx="450" cy="600" r="190" fill="hsl(${hue},42%,72%)"/>
    <text x="450" y="675" font-family="Helvetica" font-size="220" fill="white"
          text-anchor="middle">${name.slice(0, 1).toUpperCase()}</text>
    <text x="450" y="1120" font-family="Helvetica" font-size="54" fill="rgba(255,255,255,0.85)"
          text-anchor="middle">${name}</text>
    <text x="450" y="1180" font-family="Helvetica" font-size="34" fill="rgba(255,255,255,0.7)"
          text-anchor="middle">test profile</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}

// ── give the invented people this account has met a picture ────────────────
const { rows: met } = await owner.query<{
  user_id: string; tenant_id: string; display_name: string | null;
}>(
  `SELECT mp.user_id, mp.tenant_id, mp.display_name
     FROM rendezvous r
     JOIN match_profile mp
       ON mp.user_id = CASE WHEN r.user_a = $1 THEN r.user_b ELSE r.user_a END
    WHERE (r.user_a = $1 OR r.user_b = $1) AND mp.is_synthetic`,
  [me.id],
);

let pictured = 0;
for (const [i, person] of met.entries()) {
  const has = await owner.query(
    'SELECT id FROM photos WHERE user_id = $1 LIMIT 1', [person.user_id]);
  if (has.rowCount) continue;
  const ctx = { tenantId: person.tenant_id, userId: person.user_id };
  const bytes = await placeholder(person.display_name ?? 'Someone', i + 1);
  await tenantSession(ctx, (c) => photos.add(c, ctx, bytes));
  pictured++;
}
console.log(`gave ${pictured} invented people a picture`);

// ── make sure one card is waiting to be answered ───────────────────────────
const { rows: waiting } = await owner.query<{ n: number }>(
  `SELECT count(*)::int AS n
     FROM rendezvous r JOIN rendezvous_briefs b ON b.rendezvous_id = r.id
    WHERE b.for_user = $1 AND b.human_says_yes IS NULL AND r.status <> 'lapsed'`,
  [me.id],
);

if (waiting[0]!.n > 0) {
  console.log(`${waiting[0]!.n} card(s) already waiting — nothing to set up`);
} else {
  // The best pair that actually ran AND has not already been answered. Its verdict
  // stands; what is being arranged is a card to look at, not a yes.
  //
  // Introduced pairs are excluded, hard. The first version of this took the
  // best-scoring pair full stop, which was the conversation already open -- and moving
  // it back to 'decided' revoked the permission the messaging policy checks, closing a
  // live chat to set up a demo.
  const { rows: pairs } = await owner.query<{
    id: string; user_a: string; user_b: string; tenant_a: string; tenant_b: string;
  }>(
    `SELECT r.id, r.user_a, r.user_b, r.tenant_a, r.tenant_b FROM rendezvous r
      WHERE (r.user_a = $1 OR r.user_b = $1)
        AND r.runs_done > 0
        AND r.status <> 'introduced'
        AND NOT EXISTS (
          SELECT 1 FROM rendezvous_briefs b
           WHERE b.rendezvous_id = r.id AND b.for_user = $1 AND b.human_says_yes IS NOT NULL)
      ORDER BY r.both_yes DESC, r.decided_at DESC LIMIT 1`,
    [me.id],
  );
  const pair = pairs[0];
  if (!pair) {
    console.log('no rendezvous has ever run for this account — run scripts/round.ts first');
  } else {
    const x = { userId: pair.user_a, tenantId: pair.tenant_a };
    const y = { userId: pair.user_b, tenantId: pair.tenant_b };

    // Each person's verified sentences under their own session, as a round reads them
    // (see loadQuotes). The brief is code now: no model call, so nothing to meter, and
    // no concern -- nothing a conversation said reaches a card.
    const [qx, qy] = [await loadQuotes(x), await loadQuotes(y)];
    const written = await matchmakerSession(async (c) => {
      const side = async (who: { userId: string }, quotes: Quote[]) =>
        ({ card: await cardFacts(c, who.userId), tags: await publicTags(c, who.userId), quotes });
      const made = composeBoth(await side(x, qx), await side(y, qy));
      const n = await saveBriefs(c, pair.id, x, y, made);
      await c.query(
        `UPDATE rendezvous
            SET status = 'decided',
                decided_at = coalesce(decided_at, now()),
                -- The real person looks first, so the card is theirs to answer.
                first_mover = $2
          WHERE id = $1`,
        [pair.id, me.id]);
      // The invented half answers for itself, as it does in a real round.
      await autoDecideSynthetic(c, pair.id);
      return n;
    });
    console.log(`wrote ${written} brief(s); one card is now waiting`);
  }
}

const { rows: summary } = await owner.query<{
  status: string; name: string | null; waiting: boolean; photos: number;
}>(
  `SELECT r.status, mp.display_name AS name,
          (b.human_says_yes IS NULL) AS waiting,
          (SELECT count(*)::int FROM photos p WHERE p.user_id = mp.user_id) AS photos
     FROM rendezvous r
     JOIN rendezvous_briefs b ON b.rendezvous_id = r.id AND b.for_user = $1
     JOIN match_profile mp
       ON mp.user_id = CASE WHEN r.user_a = $1 THEN r.user_b ELSE r.user_a END
    WHERE r.status <> 'lapsed'
    ORDER BY r.decided_at DESC`,
  [me.id],
);
console.log('\nwhat the phone will show:');
for (const r of summary) {
  console.log(`  ${r.status.padEnd(11)} ${(r.name ?? '?').padEnd(10)} ` +
    `${r.waiting ? 'waiting on you' : 'answered'}  photos=${r.photos}`);
}

await owner.end();
await closeMatchPool();
await close();
