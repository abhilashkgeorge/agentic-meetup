/**
 * What a person reads before deciding whether to meet somebody.
 *
 * THE BRIEF IS NOT A SCORE. Pre-date self-report predicts attraction badly enough that
 * any percentage here would be a lie with a decimal point. What can be shown honestly
 * is PROVENANCE: two people said nearly the same thing, months apart, unprompted, and
 * here are both sentences with both dates. That is a true statement, and a memory that
 * overwrites its own history cannot make it.
 *
 * THE QUOTES ARE NEVER WRITTEN BY THE MODEL. It chooses PAIRS BY INDEX from quotes
 * already in the database, and the text is then read back from those rows. A model
 * asked to "quote what they said" will produce a sentence that sounds like something
 * the person would say, which is the one thing a brief must never contain -- the whole
 * value here is that the words are really theirs.
 *
 * THE CONCERN IS NOT INVENTED EITHER. It is the assessor's own reservation from the
 * runs, carried through verbatim. A brief with nothing to worry about is a brief that
 * was written to please.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { llm, modelFor } from '../llm/index.js';
import { log } from '../log.js';

export interface Quote {
  id: string;
  predicate: string;
  text: string;
  /** When it became true, not when it was recorded. "Two years ago", not "Tuesday". */
  when: string;
}

/**
 * Somebody's own sentences, public ones only.
 *
 * Under the matchmaker role the `disclosure = 'public'` clause is enforced by policy
 * as well; it is repeated here so the query says what it means when read alone.
 */
export async function loadQuotes(c: PoolClient, userId: string): Promise<Quote[]> {
  // Invented people again. Their sentences are generated from their traits and stored
  // beside them; they are not, and must never be presented as, evidence about
  // anybody. A brief built from them is a brief about somebody who does not exist,
  // which is the whole point of the pool.
  const { rows: invented } = await c.query<{
    synthetic_quotes: { predicate: string; text: string; when: string }[] | null;
  }>(
    'SELECT synthetic_quotes FROM match_profile WHERE user_id = $1 AND is_synthetic',
    [userId],
  );
  if (invented[0]?.synthetic_quotes?.length) {
    return invented[0].synthetic_quotes.map((q, i) => ({
      id: `${userId}:${i}`,
      predicate: q.predicate,
      text: q.text,
      when: monthYear(q.when ? new Date(q.when) : null),
    }));
  }

  const { rows } = await c.query<{
    id: string; predicate: string; source_quote: string; valid_from: Date | null;
  }>(
    `SELECT id, predicate, source_quote, valid_from
       FROM facts
      WHERE user_id = $1 AND status = 'active' AND valid_to IS NULL
        AND disclosure = 'public'
        AND source_quote IS NOT NULL AND length(source_quote) BETWEEN 12 AND 300
      ORDER BY valid_from DESC NULLS LAST
      LIMIT 60`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    predicate: r.predicate,
    text: r.source_quote,
    when: monthYear(r.valid_from),
  }));
}

const monthYear = (d: Date | null): string =>
  d
    ? d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : '';

const Picked = z.object({
  /** Why this person, in one line, addressed to the reader. */
  headline: z.string(),
  /** Indexes into the two quote lists. Never text. */
  pairs: z.array(z.object({
    /** Index into the READER's own sentences. */
    mine: z.number().int(),
    /** Index into the OTHER PERSON's sentences. */
    theirs: z.number().int(),
    /** What the two sentences have in common. One short phrase. */
    shared: z.string(),
  })),
  /** Two things worth asking them, in the reader's own interest. */
  questions: z.array(z.string()),
});

const PROMPT = `Two people have been matched. One of them — YOU — is about to read a short brief about the other, and decide whether to meet them.

You are given, for each person: what is known about them, and a numbered list of things they have said at different times, unprompted. Either list of sentences may be empty; most people answer with taps rather than paragraphs, and that is normal.

EVERYTHING YOU WRITE IS ABOUT THE OTHER PERSON. Never about the reader. The reader knows who they are — a brief that describes them back to themselves is useless, and it is the single easiest mistake to make here.

Return:

headline — ONE sentence about THE OTHER PERSON: what kind of person they are and why meeting them might be worth it. Start it with "They". Never describe the reader. No superlatives, no "perfect match", no percentages.

pairs — where the two SENTENCE lists genuinely touch, as INDEXES: one index into the reader's list, one into the other person's. Never the text itself.

A pair must be a real overlap: the same interest, the same value, the same way of living. Two people who both own a phone is not an overlap. Return NO pairs rather than a weak one — an empty list is a perfectly good answer and the rest of the brief still stands. Padding is how somebody ends up on a date with a stranger they were told they had a lot in common with.

questions — two things the reader would want to ASK THE OTHER PERSON before meeting, drawn from what is thin or unresolved about them. Written to the other person as "you". Not icebreakers.`;

export interface BriefContent {
  headline: string;
  overlaps: { quoteA: string; dateA: string; quoteB: string; dateB: string; shared: string }[];
  questions: string[];
}

/**
 * One side's brief. `mine` is the reader's quotes, `theirs` the other person's.
 *
 * Returns null rather than an empty brief when nothing real was found. A card that
 * says "you both exist" is worse than no card.
 */
export async function composeBrief(
  ctx: { tenantId: string; userId: string },
  mine: Quote[],
  theirs: Quote[],
  known: { mine: string; theirs: string } = { mine: '', theirs: '' },
): Promise<{ brief: BriefContent | null; costUsd: number }> {
  // MOST PEOPLE HAVE NO QUOTES. Onboarding is taps -- "climbing", "software",
  // "Bangalore" -- so every `source_quote` is one word and none of them survives the
  // length filter. Requiring quotes here meant a pair whose agents had just agreed
  // twice out of two got no card at all, and the match silently evaporated. What is
  // KNOWN about somebody is enough for a headline and two questions; the quotes are
  // the best evidence when they exist, not the price of entry.
  if (!mine.length && !theirs.length && !known.mine && !known.theirs) {
    return { brief: null, costUsd: 0 };
  }

  const list = (q: Quote[]) =>
    q.length
      ? q.map((x, i) => `${i}. (${x.predicate.replace(/_/g, ' ')}) "${x.text}"`).join('\n')
      : '(nothing recorded yet)';

  const res = await llm.complete(
    {
      task: 'extract',
      instructions: PROMPT,
      messages: [{
        role: 'user',
        content: [
          // The other person FIRST and named plainly, because that is who the brief is
          // about. With the reader's own details first, the model wrote the headline
          // about the reader every time -- both people were handed a description of
          // themselves and told it was somebody worth meeting.
          '=== THE OTHER PERSON — the brief is about them ===',
          known.theirs ? `Known about them:\n${known.theirs}` : 'Known about them: very little',
          `Things they have said:\n${list(theirs)}`,
          '',
          '=== YOU, THE READER — for finding overlaps only, never to describe ===',
          known.mine ? `Known about you:\n${known.mine}` : 'Known about you: very little',
          `Things you have said:\n${list(mine)}`,
        ].join('\n'),
      }],
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      outputSchema: Picked,
      outputSchemaName: 'brief',
      maxOutputTokens: 1024,
      thinking: false,
    },
    modelFor('extract'),
  );

  const parsed = Picked.safeParse(res.parsed);
  if (!parsed.success) {
    // Silent nulls here cost an afternoon: seven rendezvous produced no cards and the
    // logs said nothing at all, because "no brief" and "the brief failed to parse"
    // looked identical from outside.
    log.warn({ userId: ctx.userId, issues: parsed.error.issues, raw: res.parsed },
      'brief did not parse');
    return { brief: null, costUsd: res.usage.costUsd };
  }

  // Index, not text. An index that does not exist is dropped rather than repaired --
  // a repaired pair is a pair the model did not actually find.
  const overlaps = parsed.data.pairs
    .map((p) => ({ a: mine[p.mine], b: theirs[p.theirs], shared: p.shared }))
    .filter((p): p is { a: Quote; b: Quote; shared: string } => Boolean(p.a && p.b))
    .slice(0, 3)
    .map(({ a, b, shared }) => ({
      quoteA: a.text, dateA: a.when, quoteB: b.text, dateB: b.when, shared,
    }));

  // NO OVERLAP IS A RESULT, NOT A FAILURE.
  //
  // This used to return null and drop the whole card. The model was doing exactly what
  // it was told -- "do not pad", and two people who share nothing concrete get no
  // pairs -- so an honest answer deleted the match. The quotes are the BEST evidence
  // on a card, not the only thing on it: the headline, the reservation and the two
  // questions all stand on their own, and "nothing you have both said lines up" is
  // itself worth telling somebody before they meet.
  if (!overlaps.length) {
    log.info({ userId: ctx.userId, mine: mine.length, theirs: theirs.length },
      'brief has no quoted overlap');
  }

  if (!parsed.data.headline.trim()) return { brief: null, costUsd: res.usage.costUsd };

  return {
    brief: {
      headline: parsed.data.headline.trim(),
      overlaps,
      questions: parsed.data.questions.slice(0, 2).map((q) => q.trim()).filter(Boolean),
    },
    costUsd: res.usage.costUsd,
  };
}

/**
 * Write both briefs, and decide who sees the other first.
 *
 * THE ASYMMETRY IS THE POINT. Whichever side has the larger inbox decides ALONE and
 * FIRST; only then is their profile shown to the other. Dating apps run heavily
 * one-sided, and without this the flooded side is flooded again here. Both people
 * still have to say yes, so it orders the decision without deciding anything.
 */
export interface BriefPair {
  forA: BriefContent | null;
  forB: BriefContent | null;
  costUsd: number;
}

/**
 * Both briefs. MODEL ONLY -- no database client, so this cannot be called with a
 * transaction open. Two model calls take long enough that holding one would block
 * every other writer touching these rows.
 */
export async function composeBoth(
  a: { tenantId: string; userId: string; quotes: Quote[]; dossier?: string },
  b: { tenantId: string; userId: string; quotes: Quote[]; dossier?: string },
): Promise<BriefPair> {
  const [forA, forB] = await Promise.all([
    composeBrief(a, a.quotes, b.quotes, { mine: a.dossier ?? '', theirs: b.dossier ?? '' }),
    composeBrief(b, b.quotes, a.quotes, { mine: b.dossier ?? '', theirs: a.dossier ?? '' }),
  ]);
  return { forA: forA.brief, forB: forB.brief, costUsd: forA.costUsd + forB.costUsd };
}

/**
 * Write them, and decide who sees the other first.
 *
 * THE ASYMMETRY IS THE POINT. Whichever side has the larger inbox decides ALONE and
 * FIRST; only then is their profile shown to the other. Dating apps run heavily
 * one-sided, and without this the flooded side is flooded again here. Both people
 * still have to say yes, so it orders the decision without deciding anything.
 */
export async function saveBriefs(
  c: PoolClient,
  rendezvousId: string,
  a: { userId: string },
  b: { userId: string },
  briefs: BriefPair,
  concerns: { a: string; b: string },
): Promise<number> {
  let written = 0;
  for (const [side, made, concern] of [
    [a, briefs.forA, concerns.a], [b, briefs.forB, concerns.b],
  ] as const) {
    // A ROW FOR EVERY PAIR, even when there was nothing to write a brief from. The
    // row is what makes the card exist: without it the person sees nothing, and the
    // agents' concern -- which is real whether or not anybody has quotable sentences
    // -- is thrown away with it. Two people who both tapped through setup and never
    // said anything quotable still met, and still deserve to be told so.
    const content = made ?? {
      headline: 'Your agent met someone',
      overlaps: [],
      questions: [],
    };
    await c.query(
      `INSERT INTO rendezvous_briefs
         (rendezvous_id, for_user, headline, overlap_quotes, concern, questions)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (rendezvous_id, for_user) DO NOTHING`,
      [rendezvousId, side.userId, content.headline, JSON.stringify(content.overlaps),
       concern, JSON.stringify(content.questions)],
    );
    written++;
  }

  const first = await busierSide(c, a.userId, b.userId);
  await c.query('UPDATE rendezvous SET first_mover = $2 WHERE id = $1', [rendezvousId, first]);

  log.info({ rendezvousId, written, firstMover: first }, 'briefs written');
  return written;
}

/**
 * Who has more matches waiting. Ties break on the id, so the answer is stable and does
 * not depend on which row the query happened to read first.
 */
async function busierSide(c: PoolClient, a: string, b: string): Promise<string> {
  const { rows } = await c.query<{ user_id: string; n: number }>(
    `SELECT u.user_id, count(r.id)::int AS n
       FROM (VALUES ($1::uuid), ($2::uuid)) AS u(user_id)
       LEFT JOIN rendezvous r
         ON (r.user_a = u.user_id OR r.user_b = u.user_id)
        AND r.status IN ('decided', 'shown_a', 'shown_b')
      GROUP BY u.user_id`,
    [a, b],
  );
  const byUser = new Map(rows.map((r) => [r.user_id, r.n]));
  const na = byUser.get(a) ?? 0;
  const nb = byUser.get(b) ?? 0;
  if (na !== nb) return na > nb ? a : b;
  return a < b ? a : b;
}
