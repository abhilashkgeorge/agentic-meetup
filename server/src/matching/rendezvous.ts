/**
 * Two agents meeting. Several times. Counting how often both say yes.
 *
 * OFF BY DEFAULT SINCE 2026-09-23. A round no longer holds these conversations unless
 * RENDEZVOUS_RUNS asks for them, and nothing they produce reaches a person either way.
 * Why is written at `RUNS` below. What follows is the design as it stood, kept while
 * the code is.
 *
 * THE IDEA, from "Hang the DJ": the System runs a pair a thousand times and the match
 * is how often they rebel together. The good part is not the number — it is that the
 * score comes from WATCHING THE PAIR INTERACT, repeatedly, instead of comparing two
 * questionnaires. Stated preferences predict attraction badly enough that any
 * percentage derived from a form is a lie with a decimal point. A behaviour, repeated,
 * is at least a measurement.
 *
 * FIVE RUNS, NOT A THOUSAND, and not one:
 *   one    a single yes can be politeness, and LLMs are agreeable by construction
 *   five   4-of-5 against 1-of-5 is a ranking that came from behaviour
 *   more   each run costs real money and the marginal information falls away fast
 *
 * THREE RULES THAT DECIDE WHETHER THIS MEASURES ANYTHING:
 *
 * 1. RUNS ARE INDEPENDENT. Each starts clean, with no knowledge of any previous run.
 *    Runs that could see each other would converge, and five correlated runs measure
 *    exactly as much as one.
 *
 * 2. THE WRITER IS NOT THE JUDGE. A `prober` composes the messages; a separate
 *    `assessor` reads the transcript and its own human's facts and never its own
 *    earlier reasoning. Self-consistency pressure — an agent defending the warmth it
 *    wrote three turns ago — is the main engine of "we agreed on everything".
 *
 * 3. THE VERDICTS ARE SEALED AND SIMULTANEOUS. Neither side sees the other's answer
 *    before giving its own.
 *
 * THE HONEST CAVEAT, stated in the code because it decides how much the number is
 * worth: both agents run on the same base model. Their agreement is partly the model
 * agreeing with itself. That is why this produces a RANKING and never a percentage
 * shown to a human.
 */
import type { PoolClient } from 'pg';
import { contactDetail } from '@clone/shared';
import { z } from 'zod';
import { llm, modelFor } from '../llm/index.js';
import { modelIdOf } from '../llm/caps.js';
import { currentState } from '../memory/facts.js';
import { env } from '../env.js';
import { log } from '../log.js';
import { ANSWER_BY } from './expiry.js';

/**
 * How many conversations a pair gets. ZERO BY DEFAULT: a round holds no conversation.
 *
 * WHAT WAS WRONG. Five runs a pair was about 60 of the 63 model calls in a round and
 * about 95% of its cost ($0.055 a round, measured on the live database 2026-09-23) --
 * and what it produced reached a real person's card as fact. A real user with nine
 * facts and one episode, none of them about comedy, received two briefs whose concern
 * called him a comedy writer. The only thing standing between an agent's invention and
 * a card was one prompt line ("Never invent a detail", PROBER above), and a prompt line
 * is not a guard. The agreement rate was then shown as words and ORDERED the list,
 * which contaminated the very labels compare-scorers needs to judge it; and it tracked
 * how rich a file was (0.79 on invented-vs-invented pairs against 0.16 on
 * real-vs-invented) more than anything about two people. A conversation between two
 * agents holds no information that is not already in the two files.
 *
 * WHY THE CODE DEFAULT, NOT AN ENV LINE. `RENDEZVOUS_RUNS=0` in one .env would be
 * undone by a fresh machine or a lost line, and the conversations would come back
 * silently with their cost and their inventions. The default is the guarantee; the
 * env var is the deliberate opt-in, for an experiment and nothing else. Even opted in,
 * nothing a conversation says reaches a person: the brief is code (brief.ts) and the
 * orchestrator no longer carries the concern or the agreement anywhere a human looks.
 *
 * `runOnce` and `converse` stay until the code-only flow has been through its tests;
 * git keeps them after that.
 */
export const RUNS = Number(process.env.RENDEZVOUS_RUNS ?? 0);
/**
 * Messages each side sends per run.
 *
 * Both live rivals settled on three, and at three a GOOD pair scored 2 of 5 while a
 * bad one scored 0 of 4 -- the separation was real but the good pair's noes were not
 * rejections. They read "the conversation is still bogged down in exchanging abstract
 * criteria" and "has not yet established her values". That is not a verdict about the
 * person; it is a verdict about the conversation being too short to have one.
 */
const TURNS_EACH = Number(process.env.RENDEZVOUS_TURNS ?? 5);

interface Side {
  userId: string;
  tenantId: string;
  /** What this agent may say about its human. Public-disclosure facts only. */
  dossier: string;
  voice: string;
  /**
   * What the OTHER agent is told about this person before the first word: the public
   * tags and nothing more. See `say`. Optional so callers that never hand a side to
   * the other agent (tests, scripts) need not build it.
   */
  tags?: string[];
}

/**
 * The first version of this asked agents to establish "what they will not compromise
 * on", and they did exactly that: two interviewers trading abstract criteria for six
 * turns and then both reporting that they had learned nothing. Lengthening the
 * conversation made it worse, because it was more of the same.
 *
 * People do not decide this from a list of non-negotiables. They decide it from what
 * somebody says when asked about an ordinary week.
 */
const PROBER = `You represent ONE person, talking to an agent that represents somebody else. You are working out whether your two humans would enjoy each other.

Rules:
- Talk about CONCRETE things. What they did last weekend, what they are working on, what annoys them, what they would do with a free Saturday. Never ask about "values", "non-negotiables", "priorities" or "what they are looking for" -- those questions produce brochure answers from everybody.
- Say something about your own person before asking something. A conversation, not an interview.
- ONE thing at a time, short, the length of a message.
- Only say things you were actually told about your person. Never invent a detail to keep it going.
- If you do not know something they asked, say so plainly. That is useful information about how well this agent knows its human.
- Do not be charming. You are not trying to be liked.`;

/**
 * THREE outcomes, not two, and the third one is the whole fix.
 *
 * At two outcomes, every run where the agents failed to learn much came back as a NO
 * -- and the concerns said so outright: "the conversation revealed very little",
 * "lacks specific details". That is a verdict about the CONVERSATION, not about the
 * two people, and counting it as a rejection makes a good pair look incompatible.
 *
 * `not_enough` is the same rule the rest of this system already runs on: an unknown
 * is never a mismatch. Those runs count toward neither the numerator nor the
 * denominator; they are simply not evidence.
 */
const Verdict = z.object({
  /**
   * Filled FIRST, and this ordering is the mechanism rather than decoration. An
   * assessor that has just had to list four concrete things it learned cannot then
   * claim it learned nothing; one asked for a verdict first takes the cheapest answer
   * available. Giving a free "not sure" option without this made every single run
   * inconclusive -- a worse failure than the two-outcome version it replaced.
   */
  learned: z.array(z.string()),
  /**
   * SECOND, and it moved here for the same reason `learned` is first.
   *
   * The concern used to be written AFTER the verdict, which made it a justification
   * rather than an input: the model decided yes and then produced a reservation mild
   * enough to live beside it. Written before, it is something the verdict has to
   * answer to. Measured over 47 pairs, the verdict-first ordering agreed 79.3% of the
   * time against a 50% bar -- a test whose pass mark sits far below its base rate is
   * not selecting anything.
   */
  concern: z.string(),
  /** Decided last, with the evidence and the reservation already on the page. */
  verdict: z.enum(['yes', 'no', 'not_enough']),
});

const ASSESSOR = `You read a conversation between two agents and decide whether the person YOU represent would want to meet the other one.

You did not write these messages. Judge them as evidence, not as your own work.

FIRST, fill in "learned": specific things you now know about the OTHER person that were
not in what was already public about them. Concrete facts, in your own words. If you
cannot list at least three, the conversation was genuinely thin.

SECOND, write "concern": a genuine reservation about the OTHER PERSON — something that
might actually not work, by the second hour of an evening rather than in theory.
"Lifestyle compatibility" and "shared interests" are topic labels, not reservations.
Write the sentence you would say to a friend.

THEN choose:

  yes          you would spend a real evening on this, and the concern above is not
               the kind of thing that would spoil it
  no           the concern above is the kind of thing that would, or nothing you
               learned suggests these two would get on
  not_enough   you listed fewer than three things, because the agents talked past each
               other or stayed abstract

Do not choose not_enough if you were able to list three things. Having little to say is
not the same as having learned nothing, and most conversations that cover a few real
details are enough to form a view.

WHAT MAKES IT A YES. Something specific about THIS person that would suit the person
you represent: a compatible intent, a way of spending time that fits, something they
said that would still matter over dinner. Name it to yourself before you answer.

WHAT MAKES IT A NO. The best you can say is that the conversation went smoothly — or
the concern you wrote above is the kind of thing that would still be a problem in
three months.

Warmth is not evidence. Two agents being polite to each other tells you nothing about
the two people, and an agreeable transcript is the most common way this judgement goes
wrong.

JUDGE THIS PAIR ON ITS OWN TERMS. You are shown one conversation and you cannot see
the alternatives, so do not try to rank this person against people you have not met.
An earlier version of these instructions asked exactly that -- whether this pair was
better than most others -- and the honest answer from a single transcript is "I cannot
tell", which came back as a no every single time. Four pairs of invented people and
four pairs of the hand-written cohort all scored zero. A question the evidence cannot
answer is not a high standard; it is a broken one.`;

/** One independent meeting. */
async function runOnce(
  a: Side,
  b: Side,
  runNo: number,
): Promise<{
  transcript: { from: 'a' | 'b'; text: string }[];
  aVerdict: 'yes' | 'no' | 'not_enough';
  bVerdict: 'yes' | 'no' | 'not_enough';
  aConcern: string; bConcern: string;
  costUsd: number;
}> {
  const model = modelFor('chat');
  // THE ASSESSOR CAN RUN ON A DIFFERENT MODEL FROM THE PROBER, and by default does
  // not. The file's own caveat is that both sides are one base model agreeing with
  // itself; measuring it gave 79.3% agreement against a 50% bar. Breaking the
  // symmetry is one env var -- ASSESS_MODEL -- and it is left unset until the cheaper
  // intervention (the calibration in ASSESSOR above) has been measured, because
  // changing two things at once measures neither.
  const judge = env.ASSESS_MODEL ? (env.ASSESS_MODEL as typeof model) : model;
  const transcript: { from: 'a' | 'b'; text: string }[] = [];
  let costUsd = 0;

  const say = async (me: Side, them: Side, from: 'a' | 'b') => {
    const history = transcript
      .map((t) => `${t.from === from ? 'You' : 'Them'}: ${t.text}`)
      .join('\n');
    const res = await llm.complete(
      {
        task: 'chat',
        instructions: PROBER,
        messages: [
          { role: 'user', content: `About the person you represent:\n${me.dossier}` },
          ...(me.voice ? [{ role: 'user' as const, content: `How they write:\n${me.voice}` }] : []),
          // THE PUBLIC TAGS, NOT THE DOSSIER. Both agents used to be handed the other
          // person's entire file before turn one, so the "conversation" was a probe on
          // top of full disclosure and could learn nothing the file stage did not
          // already know. Given only what is public -- the same handful of tags a
          // stranger could see -- the agent has to ask, and what it learns by asking
          // is the one thing a file-versus-file score cannot measure. This is the
          // change that makes the conversation worth running at all.
          { role: 'user', content: `What is public about the other person:\n${describe(them)}` },
          {
            role: 'user',
            content: history
              ? `The conversation so far:\n${history}\n\nYour next message:`
              : 'Open the conversation. One short message.',
          },
        ],
        tenantId: me.tenantId,
        userId: me.userId,
        maxOutputTokens: 200,
        thinking: false,
      },
      model,
    );
    costUsd += res.usage.costUsd;
    transcript.push({ from, text: res.text.trim() });
  };

  // Alternating, and who opens flips each run so neither side always gets the last
  // word -- position matters to a language model far more than it should.
  const aFirst = runNo % 2 === 0;
  for (let i = 0; i < TURNS_EACH; i++) {
    if (aFirst) { await say(a, b, 'a'); await say(b, a, 'b'); }
    else        { await say(b, a, 'b'); await say(a, b, 'a'); }
  }

  const assess = async (me: Side, from: 'a' | 'b') => {
    const seen = transcript
      .map((t) => `${t.from === from ? 'Your agent' : 'Their agent'}: ${t.text}`)
      .join('\n');
    const res = await llm.complete(
      {
        task: 'resolve',
        instructions: ASSESSOR,
        messages: [
          { role: 'user', content: `The person you represent:\n${me.dossier}` },
          // Exactly what the prober was given about the other person, so "learned"
          // means learned -- things the conversation surfaced beyond what was public.
          // The old prompt asked for things "not known from their summary" and no
          // summary was ever passed in.
          { role: 'user', content: `What was already public about the other person:\n${describe(from === 'a' ? b : a)}` },
          { role: 'user', content: `The conversation:\n${seen}` },
        ],
        tenantId: me.tenantId,
        userId: me.userId,
        outputSchema: Verdict,
        outputSchemaName: 'verdict',
        maxOutputTokens: 400,
        thinking: false,
      },
      judge,
    );
    costUsd += res.usage.costUsd;
    const parsed = Verdict.safeParse(res.parsed);
    // A verdict that will not parse is NOT_ENOUGH, not a no. A broken call is an
    // absence of evidence, and recording it as a rejection would quietly punish a
    // pair for our own outage.
    return parsed.success
      ? parsed.data
      : { learned: [], verdict: 'not_enough' as const, concern: 'the assessment did not come back' };
  };

  // Sealed and simultaneous: neither assessor can see the other's answer, because
  // both are issued before either resolves.
  const [av, bv] = await Promise.all([assess(a, 'a'), assess(b, 'b')]);

  return {
    transcript,
    aVerdict: av.verdict, bVerdict: bv.verdict,
    aConcern: av.concern, bConcern: bv.concern,
    costUsd,
  };
}

/**
 * What an agent is allowed to say about its human.
 *
 * PUBLIC facts only, and the filter is in the SQL rather than in the prompt. An LLM
 * handed somebody's whole memory will cheerfully repeat all of it to a stranger; a
 * structural exclusion cannot be talked out of.
 */
export async function buildDossier(c: PoolClient, userId: string): Promise<string> {
  // An invented person has no facts, on purpose -- migration 0010 forbids an
  // untrusted-origin fact from ever being active, and bending that for the synthetic
  // pool would delete the guarantee that protects real people. Their dossier lives on
  // match_profile instead, generated from the traits they were sampled with.
  //
  // Checked FIRST because the alternative is what actually happened: the agent went
  // into five conversations with an empty dossier and agreed twice anyway.
  const { rows: invented } = await c.query<{ synthetic_dossier: string | null }>(
    'SELECT synthetic_dossier FROM match_profile WHERE user_id = $1 AND is_synthetic',
    [userId],
  );
  if (invented[0]?.synthetic_dossier) return invented[0].synthetic_dossier;

  const facts = await currentState(c, userId);
  const { rows: allowed } = await c.query<{ predicate: string }>(
    `SELECT DISTINCT predicate FROM facts
      WHERE user_id = $1 AND status = 'active' AND valid_to IS NULL
        AND disclosure = 'public'`,
    [userId],
  );
  const ok = new Set(allowed.map((r) => r.predicate));
  // No contact detail, even here (shared/src/contact.ts): these lines are told to
  // another person's agent, which is exactly the stranger a number must not reach.
  const lines = facts
    .filter((f) => ok.has(f.predicate) && contactDetail(f.objectText) === null)
    .map((f) => `- ${f.predicate.replace(/_/g, ' ')}: ${f.objectText}`);

  // NO PROSE BLOCK. This used to prepend coreProfileText, the rendered identity /
  // situation / preferences paragraphs -- and those are rendered from
  // promotableFacts, which has no disclosure clause, by a prompt that explicitly asks
  // for allergies and diet. So the itemised half of the dossier was public-only by
  // construction and the prose half was not. The header of this function promises a
  // structural exclusion; the lines below are the only part that kept it.
  return lines.join('\n');
}

/**
 * The other person, as a stranger would see them: their public tags, nothing else.
 *
 * Built from match_profile.attribute_tags, keeping a tag only when a PUBLIC fact of
 * theirs makes it -- `predicate:value`, exactly as the profile builder writes a tag
 * (profile.ts). So `religion_importance:high` cannot reach the other agent through the
 * tags even though the ranker is allowed to use it -- and neither can an interest the
 * clone learned in chat, which starts match-only (extract.ts).
 *
 * PER FACT, NOT PER KIND (2026-09-25). This used to keep every tag of a kind the person
 * had ANY public fact of: one shared interest made all their interests public, the
 * ones learned in chat included. An invented profile has no facts and no disclosure
 * rows, so its tags are taken as-is.
 */
export async function publicTags(c: PoolClient, userId: string): Promise<string[]> {
  const { rows } = await c.query<{ attribute_tags: string[]; is_synthetic: boolean }>(
    'SELECT attribute_tags, is_synthetic FROM match_profile WHERE user_id = $1', [userId]);
  const row = rows[0];
  if (!row) return [];
  if (row.is_synthetic) return row.attribute_tags;
  const { rows: shared } = await c.query<{ tag: string }>(
    `SELECT DISTINCT predicate || ':' || (object_value #>> '{}') AS tag FROM facts
      WHERE user_id = $1 AND status = 'active' AND valid_to IS NULL AND disclosure = 'public'
        AND jsonb_typeof(object_value) = 'string'`,
    [userId]);
  const ok = new Set(shared.map((r) => r.tag));
  return row.attribute_tags.filter((t) => ok.has(t));
}

/** One line per public tag, or a plain statement that there is nothing. */
function describe(side: Side): string {
  const tags = side.tags ?? [];
  if (!tags.length) return '(nothing is public about them yet)';
  return tags.map((t) => `- ${t.replace(':', ': ').replace(/_/g, ' ')}`).join('\n');
}

/**
 * Which of the run's concerns to show the human.
 *
 * The last one used to be shown, on the reasoning that it was formed with the most
 * of the conversation behind it. But five runs are five independent conversations,
 * not one long one, and the last is no better informed than the first. The concern
 * worth showing is the one the runs kept coming back to. Free text never repeats
 * exactly, so "kept coming back to" is measured by shared content words: each
 * concern is scored by how many of the others it overlaps with by at least half, and
 * the most-overlapped wins. Ties go to the later run.
 */
export function pickConcern(concerns: string[]): string {
  const said = concerns.map((c) => c.trim()).filter(Boolean);
  if (!said.length) return '';
  const words = (t: string) => new Set(
    t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
  const sets = said.map(words);
  let best = said.length - 1;
  let bestScore = -1;
  for (let i = 0; i < said.length; i++) {
    let score = 0;
    for (let j = 0; j < said.length; j++) {
      if (i === j) continue;
      const shared = [...sets[i]!].filter((w) => sets[j]!.has(w)).length;
      const smaller = Math.min(sets[i]!.size, sets[j]!.size) || 1;
      if (shared / smaller >= 0.5) score++;
    }
    if (score >= bestScore) { bestScore = score; best = i; }
  }
  return said[best]!;
}

export interface RendezvousResult {
  rendezvousId: string;
  runs: number;
  bothYes: number;
  costUsd: number;
}

/**
 * Run a pair N times and record how often both sides said yes.
 *
 * Sequential rather than parallel: the runs are independent by design, and running
 * them at once against a rate-limited free tier is how a pair ends up with two real
 * runs and three errors counted as noes.
 */
export interface RunRecord {
  runNo: number;
  transcript: unknown;
  aVerdict: 'yes' | 'no' | 'not_enough';
  bVerdict: 'yes' | 'no' | 'not_enough';
  aConcern: string;
  bConcern: string;
  costUsd: number;
}

/**
 * Retry once, on a transport failure only.
 *
 * The distinction that matters: this catches the case where nothing was said, not the
 * case where something was said and we did not like it. A retry of the latter is
 * optional stopping, and it is exactly the flaw the self-test gate was found to have.
 */
async function withRetry<T>(fn: () => Promise<T>, run: number): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    log.warn({ err, run }, 'rendezvous run failed; one retry');
    // Longer than the between-run pause: the usual cause is the free tier's rate
    // limiter, and retrying into it immediately just spends the second attempt too.
    await new Promise((r) => setTimeout(r, 5_000));
    return fn();
  }
}

export interface Conversations {
  results: RunRecord[];
  /** Runs that produced EVIDENCE. A run where either side learned too little is not
   *  counted at all -- neither as a yes nor as a no. */
  counted: number;
  bothYes: number;
  costUsd: number;
}

/**
 * The model phase, with NO DATABASE CONNECTION IN SIGHT.
 *
 * This used to run inside the transaction that wrote its results, which meant a
 * transaction stayed open for as long as five conversations take -- eighteen minutes,
 * measured -- holding a pooled connection and blocking other writers the whole time.
 * Taking no client at all is what makes that impossible to reintroduce.
 *
 * Sequential rather than parallel: the runs are independent by design, and running
 * them at once against a rate-limited free tier is how a pair ends up with two real
 * runs and three errors counted as noes.
 */
export async function converse(a: Side, b: Side, runs = RUNS): Promise<Conversations> {
  const results: RunRecord[] = [];
  let bothYes = 0;
  let costUsd = 0;
  let counted = 0;
  /** Runs whose call died outright. Diagnostic only -- see the top-up below. */
  let lost = 0;

  /** Returns true when the run produced a verdict, false when the call died. */
  const attempt = async (i: number): Promise<boolean> => {
    try {
      // ONE RETRY, and it retries a dropped CALL, never a verdict. Measured over four
      // real rendezvous, one or two runs in five died on ECONNRESET from the free
      // tier -- so a five-run measurement was routinely a three-run measurement, and
      // a 1-of-3 is a far noisier thing than a 1-of-5. Re-rolling a verdict we did
      // not like would be optional stopping; re-dialling a connection that dropped
      // before anybody said anything is not.
      const r = await withRetry(() => runOnce(a, b, i), i);
      costUsd += r.costUsd;

      const inconclusive = r.aVerdict === 'not_enough' || r.bVerdict === 'not_enough';
      if (!inconclusive) {
        counted++;
        if (r.aVerdict === 'yes' && r.bVerdict === 'yes') bothYes++;
      }

      results.push({
        runNo: i, transcript: r.transcript,
        aVerdict: r.aVerdict, bVerdict: r.bVerdict,
        aConcern: r.aConcern, bConcern: r.bConcern, costUsd: r.costUsd,
      });
      return true;
    } catch (err) {
      // A run that fails twice does not fail the rendezvous, and is NOT counted as a
      // no -- a broken call is an absence of evidence, not a rejection.
      lost++;
      log.error({ err, run: i }, 'rendezvous run failed twice');
      return false;
    }
  };

  for (let i = 0; i < runs; i++) {
    await attempt(i);

    // The free tier rate-limits, and a burst of runs returns ECONNRESET for the last
    // few -- which used to look like the pair failing rather than us.
    if (i < runs - 1) await new Promise((r) => setTimeout(r, 1500));
  }

  // ── TOP UP THE RUNS THAT NEVER HAPPENED ─────────────────────────────────────
  //
  // A dropped run does not just add noise; it silently RAISES THE BAR. `passes`
  // asks for a majority, and a majority of a smaller denominator is a bigger
  // fraction:
  //
  //     5 runs   3 of 5   60%      <- what the design intends
  //     4 runs   3 of 4   75%
  //     3 runs   2 of 3   67%
  //     2 runs   2 of 2   100%
  //
  // Across 47 pairs and then 8 more, the denominator was 1, 2, 3 or 4 and NEVER 5.
  // So every pair was judged against a threshold set by the network rather than by
  // us, and none of them was told which one. That is not a noisy measurement, it is
  // a different measurement each time.
  //
  // Only calls that DIED are retried. A `not_enough` is a real verdict about a real
  // conversation and retrying it would be optional stopping -- re-rolling a result we
  // did not like. Capped, because an outage must not turn one pair into an unbounded
  // bill.
  // The condition is the number of VERDICTS IN HAND, not the number of losses.
  //
  // Keying it on losses overshoots, and a measurement run caught it: a failed top-up
  // attempt increments `lost` itself, so the loop kept going after the denominator was
  // already full --
  //
  //     main loop ends   lost 1, counted 4
  //     k=0 fails        lost 2, counted 4
  //     k=1 succeeds     lost 1, counted 5
  //     k=2 succeeds     lost 0, counted 6   <- six runs, five planned
  //
  // -- which inflates the denominator instead of restoring it, and "a majority" over
  // six runs is a different bar again. `results` holds one entry per verdict obtained,
  // of any kind, so stopping at `runs` of them is exactly the invariant wanted: a
  // dropped call leaves no entry and is retried, while an inconclusive run leaves one
  // and is not, which is what keeps this from becoming optional stopping.
  const EXTRA = runs;
  for (let k = 0; k < EXTRA && results.length < runs; k++) {
    await new Promise((r) => setTimeout(r, 1500));
    await attempt(runs + k);
  }

  if (counted < runs) {
    log.warn({ counted, planned: runs }, 'rendezvous short of its planned runs');
  }

  return { results, counted, bothYes, costUsd };
}

/**
 * The write phase. Short, and separate, for the reason above.
 *
 * `aUserId` is who "a" was IN THE CONVERSATION, and it is required because the two are
 * not the same thing. The columns are named after `rendezvous.user_a`, which is the
 * LOWER of the two ids -- while a run's "a" is simply whoever the caller passed first,
 * normally the person whose agent went out. Get that wrong and `a_concern` ends up
 * meaning "the other one", which is exactly what happened: two people were each shown
 * their own agent's worry about THEMSELVES, presented as the one thing to check about
 * the person they were about to meet.
 *
 * So the rows are normalised here, once, to the order the table is named for. Anything
 * reading them later can use the obvious meaning and be right.
 */
export async function recordRuns(
  c: PoolClient,
  rendezvousId: string,
  out: Conversations,
  aUserId: string,
): Promise<void> {
  const { rows: pair } = await c.query<{ user_a: string }>(
    'SELECT user_a FROM rendezvous WHERE id = $1', [rendezvousId]);
  const flip = pair[0] ? pair[0].user_a !== aUserId : false;

  for (const raw of out.results) {
    const r = flip
      ? {
          ...raw,
          aVerdict: raw.bVerdict, bVerdict: raw.aVerdict,
          aConcern: raw.bConcern, bConcern: raw.aConcern,
        }
      : raw;
    await c.query(
      `INSERT INTO rendezvous_runs
         (rendezvous_id, run_no, transcript, a_says_yes, b_says_yes, a_concern, b_concern, cost_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (rendezvous_id, run_no) DO NOTHING`,
      [
        rendezvousId, r.runNo, JSON.stringify(r.transcript),
        // null, not false, when there was not enough to go on. The column carries
        // three states because the verdict has three.
        r.aVerdict === 'not_enough' ? null : r.aVerdict === 'yes',
        r.bVerdict === 'not_enough' ? null : r.bVerdict === 'yes',
        r.aConcern, r.bConcern, r.costUsd,
      ],
    );
  }

  // The cards are out: three days for the first answer (0069, matching/expiry.ts).
  await c.query(
    `UPDATE rendezvous
        SET runs_done = $2, both_yes = $3, cost_usd = $4,
            status = 'decided', decided_at = now(), answer_by = ${ANSWER_BY}
      WHERE id = $1`,
    [rendezvousId, out.counted, out.bothYes, out.costUsd],
  );
  log.info({ rendezvousId, runs: out.counted, bothYes: out.bothYes }, 'rendezvous decided');
}

/**
 * Run a pair and record the result. The two phases above, one after the other.
 *
 * Convenient, and WRONG for production use: it holds `c` across the model calls. The
 * orchestrator calls the two halves separately and closes its transaction in between.
 */
export async function meet(
  c: PoolClient,
  rendezvousId: string,
  a: Side,
  b: Side,
  runs = RUNS,
): Promise<RendezvousResult> {
  const out = await converse(a, b, runs);
  await recordRuns(c, rendezvousId, out, a.userId);
  return {
    rendezvousId, runs: out.counted, bothYes: out.bothYes, costUsd: out.costUsd,
  };
}

/**
 * How many runs must actually have happened before a verdict means anything.
 *
 * THE BUG THIS FIXES, caught in a fifty-pair measurement where EVERY pair came back
 * short. The free tier drops connections, a run that fails twice is correctly not
 * counted as a no -- a broken call is an absence of evidence -- and `counted` is
 * therefore often 2 or 3 where 5 were planned. Nothing then checked how many had
 * survived, so a pair that completed two runs and agreed twice scored 2/2 and passed.
 *
 * That is precisely the measurement this file's own header rejects: "one -- a single
 * yes can be politeness, and LLMs are agreeable by construction". Five runs were
 * chosen so that 4-of-5 against 1-of-5 means something. A 1-of-1 is the thing the
 * design was built to avoid, and network weather was quietly producing it.
 *
 * Three-fifths of what was planned, rounded up: 3 of 5, 2 of 3, 2 of 2. Below that
 * there is no verdict -- not a no, which would punish a pair for our connection, but
 * no result at all. The pair simply did not get measured.
 */
export const quorum = (planned: number): number => Math.max(1, Math.ceil(planned * 0.6));

/**
 * How much of the time a pair has to agree before a human is shown them.
 *
 * SET FROM A MEASUREMENT, NOT FROM A ROUND NUMBER. The previous value was the phrase
 * "a majority" turned into `> 0.5`, chosen before anybody had seen a distribution.
 * Two things were then measured and both said it was wrong:
 *
 *   under the old assessor, mean agreement was 79.3% across 47 pairs. A bar of 50%
 *   sitting below the average passed 36 of them -- not a matchmaker, a turnstile.
 *
 *   under the corrected assessor, mean agreement fell to 33.3% across 8 pairs and the
 *   highest any pair reached was EXACTLY 0.5 -- which `> 0.5` excludes. The bar had
 *   moved from passing nearly everything to passing nothing, without ever being
 *   deliberately set.
 *
 * `>=` rather than `>` for that reason: with five runs the reachable values are 0,
 * 0.2, 0.4, 0.6, 0.8 and 1.0, and a strict inequality against a value ON that lattice
 * silently removes a whole step. Compare against the lattice, not through it.
 *
 * Overridable because the right number depends on how often somebody wants to hear
 * from their agent, which is a product decision rather than a fact about models.
 */
export const MIN_AGREEMENT = Number(process.env.RENDEZVOUS_MIN_AGREEMENT ?? 0.6);

/**
 * Does this pair clear the bar?
 *
 * TWO CONDITIONS, AND THEY GUARD DIFFERENT THINGS. The quorum says enough runs
 * actually happened for the fraction to mean anything. The agreement rate is the
 * judgement itself.
 *
 * The rate is taken over the runs that COMPLETED rather than the runs that were
 * planned, which is only safe because `converse` now makes up runs that died on the
 * wire. Before it did, this divided by whatever survived -- so the real bar drifted
 * between 60% and 100% depending on the network, and no pair was told which one it
 * was being held to.
 */
export const passes = (bothYes: number, counted: number, planned = RUNS): boolean =>
  counted >= quorum(planned) && bothYes / counted >= MIN_AGREEMENT;
