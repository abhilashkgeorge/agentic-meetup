/**
 * Take real briefs out of the database so people who are not the founder can read them.
 *
 * THE ASSUMPTION THIS EXISTS TO TEST, and it is the largest unproven one in the whole
 * product: that a card built from a simulated conversation between two agents -- a
 * headline, a reservation, two questions, and index-selected verbatim quotes -- makes
 * a stranger want to meet somebody. Everything else is downstream of that. The
 * matching engine, the fact store, the multi-run rendezvous, the entire cost model
 * are all machinery for producing this card, and no human being other than its author
 * has ever read one.
 *
 * Ten readers and one question settles it, and it costs a weekend rather than a
 * quarter. This writes the data for that; the page that asks the question is built
 * from its output.
 *
 * NOTHING IS INVENTED HERE. Every field comes out of `rendezvous_briefs` exactly as
 * the agents wrote it. A brief that reads badly is a result, not a bug to be tidied
 * before showing anybody -- and tidying it would destroy the only measurement that
 * matters.
 *
 * PRIVACY. Names are dropped and real people are replaced with a letter. The reader
 * is being asked about the WRITING, not about a person, and a real person's card
 * should not be circulating in a survey. Synthetic profiles have no privacy to
 * protect but are treated the same way so the two are indistinguishable to a reader.
 *
 *   tsx scripts/export-briefs.ts > var/briefs.json
 */
import { Pool } from 'pg';
import { env } from '../src/env.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

interface Row {
  id: string;
  headline: string;
  concern: string;
  questions: string[];
  overlap_quotes: { quoteA: string; dateA: string; quoteB: string; dateB: string }[];
  about_synthetic: boolean;
  both_yes: number;
  runs_done: number;
}

const { rows } = await owner.query<Row>(
  `SELECT b.rendezvous_id::text || ':' || b.for_user::text AS id,
          b.headline, b.concern, b.questions, b.overlap_quotes,
          p.is_synthetic AS about_synthetic,
          r.both_yes, r.runs_done
     FROM rendezvous_briefs b
     JOIN rendezvous r ON r.id = b.rendezvous_id
     JOIN match_profile p
       ON p.user_id = CASE WHEN r.user_a = b.for_user THEN r.user_b ELSE r.user_a END
    ORDER BY r.decided_at DESC NULLS LAST, b.for_user`,
);

/**
 * Strip anything that identifies a particular person.
 *
 * A first name inside a sentence the agent wrote is the only leak here -- the
 * structured name fields are simply not selected. Matching on capitalised words would
 * eat place names and job titles, which are exactly the texture being tested, so this
 * only replaces names it can find in the database.
 */
const { rows: names } = await owner.query<{ name: string }>(
  // BOTH sources, and the second one is why this is not a one-liner. Real accounts
  // have a NULL display_name -- that column is filled for the synthetic pool -- so a
  // list built from it alone covers every invented person and none of the real ones,
  // which is exactly backwards for a privacy filter. The founder's name reached the
  // first draft of this export through a `preferred_name` fact quoted inside an
  // agent's sentence.
  `SELECT display_name AS name FROM match_profile WHERE display_name IS NOT NULL
    UNION
   SELECT object_text FROM facts
    WHERE predicate IN ('preferred_name', 'full_name') AND status = 'active'`,
);
// Split on whitespace so "Abhilash Knox George" contributes all three parts, and sort
// longest-first so a full name is replaced before one of its own words is.
const known = [...new Set(names.flatMap((n) => n.name.split(/\s+/)).filter((n) => n.length > 2))]
  .sort((a, b) => b.length - a.length);

const anonymise = (text: string): string => {
  let out = text;
  for (const name of known) {
    // "this person" rather than "they": the names sit where a subject goes, and
    // "they is so entirely consumed" is a sentence a reader stops to parse instead of
    // reading. What is being tested is whether this text lands, so it has to survive
    // the anonymising.
    out = out.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), 'this person');
  }
  return out;
};

const cards = rows.map((r, i) => ({
  ref: `brief-${String(i + 1).padStart(2, '0')}`,
  headline: anonymise(r.headline),
  concern: anonymise(r.concern),
  questions: (r.questions ?? []).map(anonymise),
  // A PAIR WHERE BOTH SIDES SAY THE SAME WORDS IS NOT AN OVERLAP.
  //
  // The card's premise is "here is what each of you said, in your own words". Every
  // pair produced so far fails it: the two strings are identical, because synthetic
  // quotes come from one template pool -- 46,346 rows carry 1,965 distinct sentences,
  // one of them repeated 2,249 times, and 73% of random pairs share one word for
  // word. What looks like two people agreeing is one generator writing twice.
  //
  // Dropped rather than shown, because anybody reading this is being asked whether
  // the BRIEF works, and a visibly duplicated quote makes them answer a different
  // question. Filtering on inequality rather than deleting the feature, so real
  // overlaps appear the moment the generator produces variety.
  overlaps: (r.overlap_quotes ?? [])
    .map((o) => ({ ...o, quoteA: anonymise(o.quoteA), quoteB: anonymise(o.quoteB) }))
    .filter((o) => o.quoteA.trim().toLowerCase() !== o.quoteB.trim().toLowerCase()),
  // Kept so the answers can be cut by how strongly the agents agreed. If readers say
  // yes to 5-of-5 pairs and no to 1-of-5 pairs, the count means something; if they
  // cannot tell them apart, the count is decoration.
  agreement: r.runs_done > 0 ? `${r.both_yes}/${r.runs_done}` : null,
  aboutSynthetic: r.about_synthetic,
}));

process.stdout.write(JSON.stringify({
  generatedFrom: 'rendezvous_briefs',
  count: cards.length,
  withOverlapQuotes: cards.filter((c) => c.overlaps.length > 0).length,
  cards,
}, null, 2));

await owner.end();
