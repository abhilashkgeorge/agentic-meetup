/**
 * The System. What actually sends an agent out.
 *
 * Everything under src/matching existed and none of it was connected: candidates
 * ranked nobody, `meet()` was called only from tests with hand-written dossiers,
 * `rendezvous_briefs` was never written to, and no code anywhere set a rendezvous to
 * 'introduced' -- which is the precondition the messaging RLS requires, so the chat
 * built on top of it could not be reached at all. This file is the join.
 *
 * IT RUNS ON THE MATCHMAKER CONNECTION, which is the only session that can read two
 * people at once, and can read nothing about either of them beyond facts they marked
 * public (migration 0028). The agent going out cannot say more than that, because the
 * database will not show it more than that.
 *
 * A FEW AT A TIME, AND NOT MANY. It used to be exactly one: the top-ranked candidate,
 * then five conversations, then -- if fewer than three of five agreed -- nothing at
 * all. Five of the seven real rounds ever run ended in nothing, and the nineteen other
 * people the ranker had scored were thrown away each time. Now the top K are met and
 * EVERY one gets a brief. K is small on purpose: Ditto ships one match a week per
 * person and reports 20% turn into dates -- scarcity is a feature before it is a cost
 * control, and three is the smallest number that gives a person a next one.
 *
 * NO MODEL ON THE DEFAULT PATH, SINCE 2026-09-23. A round was about 189 model calls
 * ($0.055, measured): five conversations a pair, a file score and two model-written
 * briefs. Now the filter, the pick and the brief are SQL and TypeScript and a round
 * costs nothing. The conversations are off unless RENDEZVOUS_RUNS asks for them (why:
 * rendezvous.ts RUNS), the file score is not taken (why: below), and the brief is a
 * template (why: brief.ts). Even with conversations switched back on, neither their
 * concern nor their agreement rate reaches anything a person reads.
 *
 * THREE PHASES, AND NO TRANSACTION AROUND THE MIDDLE ONE. The first version wrapped
 * the whole round in one `matchmakerSession`, which meant a database transaction stayed
 * open for as long as the model took -- eighteen minutes, measured, `idle in
 * transaction`, holding a connection out of a pool of four and blocking every other
 * writer touching those rows. The rest of this codebase already knew better; session
 * extraction is written the same way for the same reason.
 *
 *   read    who to meet, and what each may say. Short transaction, then closed.
 *   middle  each person's verified sentences, each under their own session; the
 *           conversations only if RENDEZVOUS_RUNS asks. NO transaction held across.
 *   write   the briefs, and the runs if any. Short transaction, per pair.
 */
import type { PoolClient } from 'pg';
import { matchmakerSession } from '../db/client.js';
import { env } from '../env.js';
import { metered } from '../metering.js';
import { log } from '../log.js';
import { candidateIds, isCandidate, overExposed } from './candidates.js';
import { jevFileScore, rank } from './score.js';
import { buildDossier, converse, passes, publicTags, recordRuns, RUNS, type Conversations } from './rendezvous.js';
import { cardFacts, composeBoth, loadQuotes, saveBriefs, type CardFacts } from './brief.js';
import { compareSheets, practiceSheet, readSheets } from './answer-sheet.js';
import {
  TALK_SENTENCES, TALK_SOURCES, agentTalk, practiceSentences, talkFor, talkOn,
} from './talk.js';
import { cantCheck, cardAnswers, checkShortlist, checkWants, demote, loadWants, notMetCounts, wantRows } from './wants.js';
import { recordUnknowns, unknownCardsOf, unknownsOf } from './unknowns.js';
import { voiceText } from '../memory/profile.js';
import { agentRef, notify } from './world.js';
import { ANSWER_BY, expireDue } from './expiry.js';

/**
 * What a pair "said" when no conversation was held -- the default. Zero runs, zero
 * cost, and so an agreement of NULL: nothing was measured, which is different from a
 * measurement of nothing.
 */
const NO_CONVERSATION: Conversations = { results: [], counted: 0, bothYes: 0, costUsd: 0 };

/** How many people one round meets. Keep this small; see the header. */
export const CANDIDATES_PER_ROUND = Number(process.env.ROUND_CANDIDATES ?? 3);

export interface RoundResult {
  userId: string;
  considered: number;
  /** The first person met, kept for callers that still think in ones. */
  met: string | null;
  /** Everyone met this round, in pick order (real first). Each now has a brief waiting. */
  metAll: string[];
  bothYes: number;
  runs: number;
  /** Whether ANY pair cleared the old bar. Informational: nothing gates on it now. */
  passed: boolean;
  costUsd: number;
  /** Why nothing happened, when nothing happened. */
  skipped?: string;
  /** The one person this round was sent to, when it was sent to one. */
  target?: string;
}

/**
 * Send one person's agent out once.
 *
 * Returns a result rather than throwing when there is nobody to meet: an empty pool is
 * an ordinary state, not an error, and the caller shows it to the person as one.
 */
export interface RoundOptions {
  /** The round row this run belongs to, for the events; null from a script. */
  roundId?: string;
  /**
   * Meet this one person and nobody else -- "send my agent over" from the square.
   * Checked against the full candidate rules (blocks included) here, not only at
   * the endpoint: the tap and the run are minutes apart and either side may have
   * changed their mind in between.
   */
  target?: string;
}

export async function runRound(userId: string, opts: RoundOptions = {}): Promise<RoundResult> {
  const roundId = opts.roundId ?? null;
  const target = opts.target ?? null;
  const empty = (skipped: string): RoundResult => ({
    userId, considered: 0, met: null, metAll: [], bothYes: 0, runs: 0, passed: false,
    costUsd: 0, skipped, ...(target ? { target } : {}),
  });

  // ── read: the shortlist ─────────────────────────────────────────────────────
  const shortlist = await matchmakerSession(async (c) => {
    const { rows: meRows } = await c.query<{ tenant_id: string; in_pool: boolean }>(
      'SELECT tenant_id, in_pool FROM match_profile WHERE user_id = $1', [userId],
    );
    const me = meRows[0];
    if (!me) return { stop: 'no profile' } as const;
    if (!me.in_pool) return { stop: 'agent is not ready to go out yet' } as const;

    let ids: string[];
    if (target) {
      // Exact, not "within the first 500": the same clauses as the open round, so a
      // person the filters or a block would keep apart cannot be reached by tapping.
      if (!(await isCandidate(c, userId, target))) {
        return { stop: 'they are not someone your agent can meet' } as const;
      }
      ids = [target];
    } else {
      ids = await candidateIds(c, userId, 500);
      if (!ids.length) return { stop: 'nobody fits what you have asked for' } as const;
    }

    // A pair meets ONCE, ever. Running the same two people again next week turns a
    // match into a war of attrition, and the second run measures the same two
    // dossiers it measured the first time.
    const { rows: already } = await c.query<{ other: string }>(
      `SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS other
         FROM rendezvous WHERE user_a = $1 OR user_b = $1`,
      [userId],
    );
    const met = new Set(already.map((r) => r.other));
    const fresh = ids.filter((id) => !met.has(id));
    if (!fresh.length) {
      return { stop: target ? 'your agent has already met them' : 'your agent has already met everyone who fits' } as const;
    }

    // NOBODY IS FLOODED. A real person already brought by five other real people's
    // rounds this week is not picked again this week (overExposed): still a
    // candidate, still reachable next week, just not the whole pool's first stop.
    const capped = await overExposed(c, fresh);
    const pickable = fresh.filter((id) => !capped.has(id));
    if (!pickable.length) {
      return { stop: target ? 'they have met a lot of people this week' : 'everyone who fits has met a lot of people this week' } as const;
    }

    // PICKED IN THE CANDIDATE QUERY'S ORDER: real people first, then the most recently
    // active (candidateIds). It used to be re-sorted by rank(), and that buried every
    // real person under five thousand invented ones -- rank()'s re-fetch has no ORDER
    // BY (score.ts), its sort is by a score invented profiles win on richer tags, and
    // with three picks a round a real person was reached only by luck. The score is
    // still worked out and recorded on each pair, because it is one of the scorers
    // compare-scorers.ts is measuring; it just no longer decides who is met.
    const window = pickable.slice(0, target ? 1 : 20);
    const scores = new Map((await rank(c, userId, window, window.length)).map((s) => [s.userId, s.score]));
    const ranked = window.map((id) => ({ userId: id, score: scores.get(id) ?? 0 }));

    const a = { userId, tenantId: me.tenant_id };
    // Loaded once. The dossier and voice are for the conversations and the typed file
    // score, both off by default; the card and the tags are what the brief is built
    // from. Quotes are NOT read here: verifying one reads the person's own episodes,
    // which this role cannot see (see loadQuotes).
    const dossierA = await buildDossier(c, a.userId);
    const voiceA = await voiceText(c, a.userId);
    const cardA = await cardFacts(c, a.userId);
    const tagsA = await publicTags(c, a.userId);

    // Who each candidate is -- their tenant, and whether they are invented -- for the
    // wants check and for the claims, in the shortlist's order.
    const { rows: whoRows } = await c.query<{ user_id: string; tenant_id: string; is_synthetic: boolean }>(
      'SELECT user_id, tenant_id, is_synthetic FROM match_profile WHERE user_id = ANY($1::uuid[])',
      [ranked.map((r) => r.userId)]);
    const whoById = new Map(whoRows.map((r) => [r.user_id, r]));
    const order = ranked.flatMap((r) => {
      const w = whoById.get(r.userId);
      return w ? [{ ...r, tenantId: w.tenant_id, synthetic: w.is_synthetic }] : [];
    });

    return {
      stop: null,
      considered: ranked.length,
      a: { ...a, dossier: dossierA, voice: voiceA, card: cardA, tags: tagsA },
      order,
    } as const;
  });
  if (shortlist.stop) return empty(shortlist.stop);

  // ── the wants, before anybody is claimed (wants.ts) ─────────────────────────
  //
  // ONLY DOWN, AND OUTSIDE ANY TRANSACTION. The starter's own wants are checked against
  // the shortlist's sentences in one call; a candidate a want is not met by moves later
  // in the order, within their own group, and nobody moves up or out. It runs here,
  // between the shortlist and the claims, because a model call inside the read
  // transaction is the eighteen-minute transaction this file was split to end. A round
  // sent to one person has nothing to reorder, but their card still carries the wants;
  // a person with no wants makes no call.
  const spender = { tenantId: shortlist.a.tenantId, userId: shortlist.a.userId };
  const wantsA = await loadWants(spender);
  const pre = wantsA.length
    ? await metered(spender, 'rendezvous', () => checkShortlist(spender, wantsA, shortlist.order))
    : null;
  const order = pre && !target ? demote(shortlist.order, notMetCounts(pre.byId)) : shortlist.order;

  // ── read: the claims ────────────────────────────────────────────────────────
  const plan = await matchmakerSession(async (c) => {
    const a = shortlist.a;

    // THE TOP K, EACH CLAIMED INSIDE THIS TRANSACTION, so two rounds started at once
    // cannot both decide to run the same pair. A candidate whose claim fails was
    // taken by a concurrent round and is simply skipped; the next in rank fills in.
    const pairs: Array<{
      rendezvousId: string;
      rankScore: number;
      b: { userId: string; tenantId: string; synthetic: boolean; dossier: string; voice: string; card: CardFacts; tags: string[] };
    }> = [];
    const k = target ? 1 : CANDIDATES_PER_ROUND;
    for (const cand of order) {
      if (pairs.length >= k) break;
      const b = { userId: cand.userId, tenantId: cand.tenantId, synthetic: cand.synthetic };
      // The pair key is ordered, because the unique index is.
      const [lo, hi] = a.userId < b.userId ? [a, b] : [b, a];
      const { rows: created } = await c.query<{ id: string }>(
        `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, rank_score)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (user_a, user_b) DO NOTHING
         RETURNING id`,
        [lo.userId, hi.userId, lo.tenantId, hi.tenantId, RUNS, cand.score],
      );
      if (!created[0]) continue;

      // Sequential, NOT Promise.all. These share one pooled client, and node-postgres
      // warns that issuing a second query while the first is in flight is deprecated
      // and going away -- it currently serialises them for us, which is exactly the
      // kind of thing that works until it does not.
      const dossierB = await buildDossier(c, b.userId);
      const voiceB = await voiceText(c, b.userId);
      const cardB = await cardFacts(c, b.userId);
      const tagsB = await publicTags(c, b.userId);
      pairs.push({
        rendezvousId: created[0].id, rankScore: cand.score,
        b: { ...b, dossier: dossierB, voice: voiceB, card: cardB, tags: tagsB },
      });
    }
    if (!pairs.length) return { stop: 'already met' } as const;

    return { stop: null, considered: shortlist.considered, a, pairs } as const;
  });

  if (plan.stop) return empty(plan.stop);

  // THE TOWN HEARS IT FIRST. Every pair is claimed by now, so both sides can be told
  // "somebody is walking over" before anything else happens -- each with their own
  // per-viewer ref for the other, never an id. The visited side gets no roundId: it
  // is not their round. An invented person has no socket and pushTo is a no-op.
  for (const pair of plan.pairs) {
    notify(userId, {
      type: 'round.met', roundId, rendezvousId: pair.rendezvousId,
      agent: agentRef(userId, pair.b.userId), practice: pair.b.synthetic,
    });
    notify(pair.b.userId, {
      type: 'round.met', roundId: null, rendezvousId: pair.rendezvousId,
      agent: agentRef(pair.b.userId, userId), practice: false,
    });
  }

  // ── the middle. No transaction held across it, and metered. ──────────────────
  //
  // ONE METER ROUND THE WHOLE ROUND. Since 2026-09-24 the default path makes one small
  // call per pair -- the agents' talk (talk.ts) -- and it is counted here, on the
  // starter's day, like RENDEZVOUS_RUNS and DECIDE_MODEL when those are switched on. A
  // call with no meter open throws rather than spending for free. The day's cap is
  // checked once, before the round; a round of three pairs adds three turns to it.
  //
  // No `db` argument: this phase deliberately holds no transaction, which is the
  // entire reason the orchestrator is split into three phases.
  // Pairs whose write has landed. Anything else is still a bare claim if this throws.
  const written = new Set<string>();
  const outcomes = await metered(spender, 'rendezvous', async () => {
    // The sender's own verified sentences, once: they go on every card the round
    // writes for the people met. Each person's under their OWN session -- see
    // loadQuotes for why the matchmaker cannot do it.
    const quotesA = await loadQuotes(plan.a);
    // THE ANSWER SHEETS, read -- never built -- here. Built once per change by each
    // person's own session (answer-sheet.ts), so the exchange on every card costs a
    // read and no model call. The words come live from `facts` under the matchmaker's
    // row-level security: a sentence hidden since the sheet was built is not returned.
    // A practice profile has nothing it ever typed; its sheet is a labelled template.
    const sheets = await matchmakerSession((c) => readSheets(c, [
      plan.a.userId, ...plan.pairs.filter((p) => !p.b.synthetic).map((p) => p.b.userId),
    ]));
    const sheetA = sheets.get(plan.a.userId);
    // THE AGENTS TALK (talk.ts): one small call a pair, reading only sentences that
    // pass the quote check, and writing nothing about anybody -- it points at them. The
    // starter's own sentences are read once; a pair whose talk fails keeps the sheets.
    const talking = talkOn();
    // The starter's own sentences, once: the talk's side A, and what the other person's
    // wants are checked against.
    const sentencesA = (await loadQuotes(plan.a, { predicates: TALK_SOURCES, limit: TALK_SENTENCES }))
      .map((q) => ({ text: q.text }));
    const talkA = talking ? sentencesA : [];
    const out: Array<{
      pair: (typeof plan.pairs)[number];
      runs: Conversations;
      ok: boolean;
      briefs: ReturnType<typeof composeBoth>;
      /** The fourth scorer, or null when no typed model is configured. */
      jevScore: number | null;
      jevCost: number;
      /** What the agents' talk cost; 0 when they did not talk. */
      talkCost: number;
      /** What checking the other person's wants against the starter cost. */
      wantCost: number;
      /** The questions each side's agent could not answer in this meeting. */
      gaps: { a: string[]; b: string[] };
    }> = [];
    for (const pair of plan.pairs) {
      notify(userId, { type: 'round.talking', roundId, rendezvousId: pair.rendezvousId,
                       agent: agentRef(userId, pair.b.userId) });
      notify(pair.b.userId, { type: 'round.talking', roundId: null, rendezvousId: pair.rendezvousId,
                              agent: agentRef(pair.b.userId, userId) });

      // NO FILE SCORE. `llmFileScore` was one model call a pair, recorded and never
      // read, and only ever taken on real-vs-invented pairs -- whose answers say
      // nothing about two real people, so nothing it measured could transfer. It
      // stays in score.ts for compare-scorers to read the old rows; it is not called.
      //
      // The typed-decision scorer stays exactly as it was: a no-op unless DECIDE_MODEL
      // is set. Its failure is not the round's -- an experiment nobody reads must
      // never cost somebody the card they asked for.
      const jev = await jevFileScore(plan.a, pair.b).catch((err: unknown) => {
        log.warn({ err, userId }, 'typed file score failed; the round continues');
        return { score: null, costUsd: 0 };
      });
      // NO CONVERSATION unless RENDEZVOUS_RUNS asks for one -- not even an empty
      // call: `converse` with zero runs is a no-op today, but "skipped" should be
      // true of the code, not of an argument.
      const runs = RUNS > 0 ? await converse(plan.a, pair.b) : NO_CONVERSATION;
      const ok = RUNS > 0 && passes(runs.bothYes, runs.counted, RUNS);

      // A BRIEF FOR EVERY PAIR, written by code from what is true of both people.
      // Nothing from a conversation goes into it -- not the concern, not the rate --
      // even when conversations have been switched back on. See brief.ts.
      const quotesB = await loadQuotes(pair.b);
      // What the two agents asked each other: the same twelve questions, each side's
      // answers in its person's own words, "I don't know" where they never said.
      const sheetB = pair.b.synthetic ? practiceSheet(pair.b.tags) : sheets.get(pair.b.userId);
      // Their side of the talk: a person's verified sentences, under their own session
      // like the quotes; a practice profile's template lines, marked practice.
      const talkB = !talking ? []
        : pair.b.synthetic ? await matchmakerSession((c) => practiceSentences(c, pair.b.userId))
        : (await loadQuotes(pair.b, { predicates: TALK_SOURCES, limit: TALK_SENTENCES })).map((q) => ({ text: q.text }));
      const said = talking ? await agentTalk(spender, talkA, talkB) : { talk: null, costUsd: 0 };
      // THE OTHER SIDE'S WANTS, against the starter's sentences, for their card. The
      // starter's own were checked before the claims (above). An invented person has
      // no wants.
      const wantsB = pair.b.synthetic ? [] : await loadWants(pair.b);
      const bChecked = wantsB.length
        ? await checkWants(spender, wantsB, [sentencesA], [(await cardAnswers([plan.a.userId])).get(plan.a.userId) ?? null])
        : null;
      const briefs = composeBoth(
        { card: plan.a.card, tags: plan.a.tags, quotes: quotesA },
        { card: pair.b.card, tags: pair.b.tags, quotes: quotesB },
        { forA: compareSheets(sheetA, sheetB), forB: compareSheets(sheetB, sheetA) },
        { forA: talkFor(said.talk, 'a'), forB: talkFor(said.talk, 'b') },
        // NEVER DROPPED: a want the check did not reach -- the call failed, or they were
        // past the window -- is on the card as "We can't check this one yet".
        {
          forA: wantRows(pre?.byId.get(pair.b.userId) ?? cantCheck(wantsA)),
          forB: wantRows(bChecked ? bChecked.results[0] : cantCheck(wantsB)),
        },
      );
      // WHO SAID "I DON'T KNOW", to what (unknowns.ts): the question of the day for that
      // person, later. Real people only -- a practice profile has nobody to ask.
      const qaA = compareSheets(sheetA, sheetB);
      const qaB = compareSheets(sheetB, sheetA);
      const talked = unknownsOf(talkFor(said.talk, 'a'), qaA, qaB);
      // And the CARDS a want could not read: A's private wants against B's card answers
      // are B's gaps, and B's against A's are A's (unknowns.ts CARD_QUESTIONS).
      const gaps = {
        a: [...talked.a, ...unknownCardsOf(bChecked?.results[0])],
        b: [...talked.b, ...unknownCardsOf(pre?.byId.get(pair.b.userId))],
      };
      const o = { pair, runs, ok, briefs, jevScore: jev.score, jevCost: jev.costUsd, talkCost: said.costUsd,
                  wantCost: bChecked?.costUsd ?? 0, gaps };
      out.push(o);

      // ── write, PER PAIR, in its own short transaction ───────────────────────
      // What it buys is that the first person met is on the record -- brief, and
      // runs if any were held -- before the next pair is looked at, so a crash
      // mid-round keeps what was done, and the town's event and the roster's poll can
      // never disagree about a pair: the event is sent only once the row says the same.
      await matchmakerSession(async (c) => {
        await writePair(c, plan.a, o);
        await recordUnknowns(c, [
          { tenantId: plan.a.tenantId, userId: plan.a.userId, questionIds: o.gaps.a },
          ...(pair.b.synthetic ? [] : [{ tenantId: pair.b.tenantId, userId: pair.b.userId, questionIds: o.gaps.b }]),
        ]);
      });
      written.add(pair.rendezvousId);
      // "They met", and nothing about how it went: the event carries no verdict and
      // no words, so the square draws the same small moment for every pair.
      notify(userId, { type: 'round.decided', roundId, rendezvousId: pair.rendezvousId,
                       agent: agentRef(userId, pair.b.userId) });
      notify(pair.b.userId, { type: 'round.decided', roundId: null, rendezvousId: pair.rendezvousId,
                              agent: agentRef(pair.b.userId, userId) });
    }
    return out;
  }).catch(async (err: unknown) => {
    // THE CLAIMS THIS ROUND NEVER USED GO BACK. The read phase claimed one row per
    // pair before anything else, so that two rounds could not run the same pair at
    // once; a round that then dies -- the day's cap, a failed read -- used to leave
    // those rows 'running' for ever, and "a pair meets once" then counted them: three
    // people this agent never met, never to be met. What was written stays (the
    // pairs in `written`); a claim with nothing behind it is released.
    const unused = plan.pairs.map((p) => p.rendezvousId).filter((id) => !written.has(id));
    if (unused.length) await matchmakerSession((c) => releaseClaims(c, unused));
    throw err;
  });

  const costUsd = (pre?.costUsd ?? 0)
    + outcomes.reduce((n, o) => n + o.runs.costUsd + o.jevCost + o.talkCost + o.wantCost, 0);
  const bothYes = outcomes.reduce((n, o) => n + o.runs.bothYes, 0);
  const runs = outcomes.reduce((n, o) => n + o.runs.counted, 0);
  const passed = outcomes.some((o) => o.ok);
  const metAll = outcomes.map((o) => o.pair.b.userId);
  log.info(
    { userId, met: metAll.length, runs, bothYes, passed, costUsd },
    'round complete',
  );
  return {
    userId, considered: plan.considered, met: metAll[0] ?? null, metAll,
    bothYes, runs, passed, costUsd, ...(target ? { target } : {}),
  };
}

/**
 * Delete the given rendezvous rows IF they are still bare claims: running, with no
 * transcript and no brief. The policy (0055) says the same thing, so a row that has
 * become a conversation in the meantime is simply left alone, whatever is passed.
 */
export async function releaseClaims(c: PoolClient, ids: readonly string[]): Promise<number> {
  if (!ids.length) return 0;
  const { rowCount } = await c.query(
    `DELETE FROM rendezvous r
      WHERE r.id = ANY($1::uuid[]) AND r.status = 'running'
        AND NOT EXISTS (SELECT 1 FROM rendezvous_runs x WHERE x.rendezvous_id = r.id)
        AND NOT EXISTS (SELECT 1 FROM rendezvous_briefs b WHERE b.rendezvous_id = r.id)`,
    [ids],
  );
  return rowCount ?? 0;
}

/** One pair's record: runs if any, scores, briefs, and the invented side's yes if allowed. */
async function writePair(
  c: PoolClient,
  a: { userId: string },
  o: {
    pair: { rendezvousId: string; b: { userId: string } };
    runs: Conversations;
    briefs: ReturnType<typeof composeBoth>;
    jevScore: number | null;
  },
): Promise<void> {
  // With no conversation this inserts no runs and only marks the pair decided, with
  // zero runs done -- the same state a round with conversations reaches, minus them.
  await recordRuns(c, o.pair.rendezvousId, o.runs, a.userId);
  // What the conversations thought, kept for compare-scorers and nothing else. NULL
  // when none was held or none was conclusive -- on the default path, always. It no
  // longer orders anything a person sees (api/dating.ts) and is never shown.
  const agreement = o.runs.counted > 0 ? o.runs.bothYes / o.runs.counted : null;
  await c.query(
    'UPDATE rendezvous SET agreement = $2, jev_file_score = $3 WHERE id = $1',
    [o.pair.rendezvousId, agreement, o.jevScore]);
  await saveBriefs(c, o.pair.rendezvousId, a, o.pair.b, o.briefs);
  // An invented person cannot open the app and tap yes -- and taking it as a yes
  // anyway is how a real person ended up introduced to nobody, in a conversation
  // that would never be answered. Off by default; on only when the founder is
  // walking the messaging flow by hand. See SYNTHETIC_AUTO_YES.
  if (env.SYNTHETIC_AUTO_YES) await autoDecideSynthetic(c, o.pair.rendezvousId);
}

/**
 * Synthetic people say yes, because there is nobody there to say anything.
 *
 * Marked `decided_at` like any other answer but with `human_says_yes = true` written
 * by the system, so a later audit can tell an invented yes from a real one. Without
 * this the founder's own account can never reach a conversation, and the messaging is
 * untestable outside the test suite.
 */
export async function autoDecideSynthetic(c: PoolClient, rendezvousId: string): Promise<number> {
  const { rows } = await c.query<{ user_id: string }>(
    `SELECT b.for_user AS user_id
       FROM rendezvous_briefs b
       JOIN match_profile p ON p.user_id = b.for_user
      WHERE b.rendezvous_id = $1 AND p.is_synthetic AND b.human_says_yes IS NULL`,
    [rendezvousId],
  );
  for (const r of rows) {
    await c.query(
      `UPDATE rendezvous_briefs SET human_says_yes = true, decided_at = now()
        WHERE rendezvous_id = $1 AND for_user = $2`,
      [rendezvousId, r.user_id],
    );
  }
  return rows.length;
}

/**
 * Record a human's answer, and introduce the pair if both have now said yes.
 *
 * A NO IS SILENT IN BOTH DIRECTIONS. The other person is never told; their card simply
 * never arrives. In a small pool where people compare notes, an emitted rejection is
 * unrecoverable.
 */
export async function decide(
  userId: string,
  rendezvousId: string,
  yes: boolean,
): Promise<{ introduced: boolean }> {
  return matchmakerSession(async (c) => {
    // TIME IS UP FIRST (0069). A card past its three days is expired before anything
    // is written, and an expired card takes no answer -- not a yes that would introduce
    // two people after the other had been told nothing for days, and not a no that
    // would turn the record of silence into a rejection.
    await expireDue(c);
    const { rowCount } = await c.query(
      `UPDATE rendezvous_briefs SET human_says_yes = $3, decided_at = now()
        WHERE rendezvous_id = $1 AND for_user = $2 AND human_says_yes IS NULL
          AND EXISTS (SELECT 1 FROM rendezvous WHERE id = $1 AND status <> 'expired')`,
      [rendezvousId, userId, yes],
    );
    if (!rowCount) return { introduced: false };

    if (!yes) {
      await c.query(
        `UPDATE rendezvous SET status = 'lapsed' WHERE id = $1 AND status <> 'introduced'`,
        [rendezvousId],
      );
      // NOTHING is sent to anybody. The town on the other phone keeps showing
      // "waiting", which is what "has not looked yet" also looks like.
      return { introduced: false };
    }

    const { rows: seat } = await c.query<{ user_a: string; user_b: string; first_mover: string | null }>(
      'SELECT user_a, user_b, first_mover FROM rendezvous WHERE id = $1', [rendezvousId]);
    const other = seat[0] ? (seat[0].user_a === userId ? seat[0].user_b : seat[0].user_a) : null;

    // Both, and exactly both. The status flip is what the messaging policy checks, so
    // this single statement is the difference between two people who cannot write to
    // each other and two people who can.
    const { rows } = await c.query<{ id: string }>(
      `UPDATE rendezvous r SET status = 'introduced', introduced_at = now()
        WHERE r.id = $1
          AND r.status <> 'introduced'
          AND (SELECT count(*) FROM rendezvous_briefs b
                WHERE b.rendezvous_id = r.id AND b.human_says_yes) = 2
      RETURNING r.id`,
      [rendezvousId],
    );

    if (rows.length) {
      log.info({ rendezvousId }, 'introduced');
      if (other) {
        notify(userId, { type: 'match.introduced', rendezvousId, agent: agentRef(userId, other) });
        notify(other, { type: 'match.introduced', rendezvousId, agent: agentRef(other, userId) });
      }
    } else {
      // A yes that did not introduce hands the turn on: the other person gets their
      // own three days from now.
      await c.query(
        `UPDATE rendezvous SET answer_by = ${ANSWER_BY} WHERE id = $1 AND status = 'decided'`, [rendezvousId]);
    }
    if (!rows.length && other && seat[0]?.first_mover === userId) {
      // The first mover said yes: it is the other person's turn to look. This is the
      // one moment a yes is visible to the other side -- as it must be, since their
      // reveal opens on it -- and it says nothing they could not already see there.
      notify(other, { type: 'match.turn', rendezvousId, agent: agentRef(other, userId) });
    }
    return { introduced: rows.length > 0 };
  });
}
