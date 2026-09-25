/**
 * What your agent did while it was out: a recap after each round.
 *
 * THE FOUNDER'S ITEM 11: "agent recap after each round (code templates + shareable own
 * words only, no verdicts, no numbers, no invented facts)." So every word here is one
 * of two kinds:
 *   - a TEMPLATE written in this file -- "Your agent went out and met someone new." --
 *     the same words for everybody, holding no digit and no judgement of anybody;
 *   - the person's OWN sentence, verbatim, that their agent actually used for them in
 *     this round (a talk line or an answer-sheet answer on their card), and only while
 *     it is still shareable: public, current, and passing the contact-detail block
 *     (mayRepeat) -- checked again now, so one they hid since is gone.
 * Never the other person's words (their card is where those belong, on its own terms),
 * never the date idea (a model wrote it), never a count or a score.
 */
import type { PoolClient } from 'pg';
import { tenantSession, type TenantCtx } from '../db/client.js';
import { mayRepeat, readBrief, sentenceKey, type BriefCard } from './brief.js';
import type { RoundResult } from './orchestrator.js';

export interface Recap {
  /** What happened, in one template sentence. */
  went: string;
  /** Up to two of the person's own shareable sentences their agent used, verbatim. */
  said: string[];
  /** What the agents talked about: question labels from the fixed bank. */
  topics: string[];
  /** What their agent had to answer "I don't know" to -- things to tell it. */
  unsure: string[];
}

/** The template sentences. Tested to hold no digit and no verdict word. */
export const RECAP_WENT = {
  nobody: 'Your agent went out and found nobody new to meet.',
  one: 'Your agent went out and met someone new.',
  some: 'Your agent went out and met some new people.',
} as const;

const MAX_SAID = 2;
const MAX_TOPICS = 3;
const MAX_UNSURE = 2;

/**
 * The recap, from the cards this round wrote for the person. Pure.
 *
 * `live` is the person's own sentences that are shareable right now (sentenceKey of
 * each public, active, current fact); a sentence not in it is not repeated.
 */
export function composeRecap(met: number, cards: readonly BriefCard[], live: ReadonlySet<string>): Recap {
  const went = met === 0 ? RECAP_WENT.nobody : met === 1 ? RECAP_WENT.one : RECAP_WENT.some;
  const said: string[] = [];
  const topics: string[] = [];
  const unsure: string[] = [];
  const add = (list: string[], v: string, max: number) => {
    if (list.length < max && !list.includes(v)) list.push(v);
  };
  const shareable = (t: string) => mayRepeat(t) && live.has(sentenceKey(t));

  for (const card of cards) {
    for (const l of card.qa) {
      add(topics, l.q, MAX_TOPICS);
      if (l.mine === null) add(unsure, l.q, MAX_UNSURE);
      else if (shareable(l.mine)) add(said, l.mine, MAX_SAID);
    }
    const lines = card.talk?.lines ?? [];
    lines.forEach((l, i) => {
      if (l.kind === 'ask' && l.q) add(topics, l.q, MAX_TOPICS);
      if (l.who !== 'you' || l.practice) return;
      if (l.kind === 'say' && shareable(l.text)) add(said, l.text, MAX_SAID);
      // "I don't know" answers the question asked just before it, by the other agent.
      const asked = lines[i - 1];
      if (l.kind === 'dunno' && asked?.kind === 'ask' && asked.q) add(unsure, asked.q, MAX_UNSURE);
    });
  }
  return { went, said, topics, unsure };
}

/**
 * The recap of a finished round, for the person who sent their agent out. Reads only
 * their own rows: their briefs from this round, and their own shareable sentences.
 */
export async function roundRecap(
  ctx: TenantCtx,
  round: { requestedAt: string; finishedAt: string | null; result: RoundResult | null },
): Promise<Recap | null> {
  const result = round.result;
  if (!result || result.skipped || !round.finishedAt) return null;
  return tenantSession(ctx, async (db) => {
    const cards = result.metAll.length ? await cardsOfRound(db, ctx.userId, result.metAll, round) : [];
    const { rows } = await db.query<{ source_quote: string }>(
      `SELECT source_quote FROM facts
        WHERE user_id = $1 AND disclosure = 'public' AND status = 'active' AND valid_to IS NULL`, [ctx.userId]);
    return composeRecap(result.metAll.length, cards, new Set(rows.map((r) => sentenceKey(r.source_quote))));
  });
}

/** The person's own briefs from this round: the pairs with the people it met, made while it ran. */
async function cardsOfRound(
  db: PoolClient, me: string, met: readonly string[], round: { requestedAt: string; finishedAt: string | null },
): Promise<BriefCard[]> {
  const { rows } = await db.query<{ headline: string; overlap_quotes: unknown; questions: unknown }>(
    `SELECT b.headline, b.overlap_quotes, b.questions
       FROM rendezvous r
       JOIN rendezvous_briefs b ON b.rendezvous_id = r.id AND b.for_user = $1
      WHERE (r.user_a = $1 AND r.user_b = ANY($2::uuid[]) OR r.user_b = $1 AND r.user_a = ANY($2::uuid[]))
        AND r.created_at BETWEEN $3 AND $4`,
    [me, met, round.requestedAt, round.finishedAt]);
  return rows.map(readBrief);
}
