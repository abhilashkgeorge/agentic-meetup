/**
 * Two agents meeting. Several times. Counting how often both say yes.
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
import { z } from 'zod';
import { llm, modelFor } from '../llm/index.js';
import { modelIdOf } from '../llm/caps.js';
import { currentState } from '../memory/facts.js';
import { coreProfileText, voiceText } from '../memory/profile.js';
import { env } from '../env.js';
import { log } from '../log.js';

export const RUNS = Number(process.env.RENDEZVOUS_RUNS ?? 5);
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

FIRST, fill in "learned": specific things you now know about the OTHER person that you
did not know from their summary. Concrete facts, in your own words. If you cannot list
at least three, the conversation was genuinely thin.

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
          { role: 'user', content: `About the other person, as their agent has described them:\n${them.dossier}` },
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
  const lines = facts
    .filter((f) => ok.has(f.predicate))
    .map((f) => `- ${f.predicate.replace(/_/g, ' ')}: ${f.objectText}`);

  const profile = await coreProfileText(c, userId);
  return [profile, lines.join('\n')].filter(Boolean).join('\n\n');
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
  /** Runs that produced no verdict at all because the call died. Topped up below. */
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
  const EXTRA = runs;
  for (let k = 0; k < EXTRA && lost > 0; k++) {
    await new Promise((r) => setTimeout(r, 1500));
    if (await attempt(runs + k)) lost -= 1;
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

  await c.query(
    `UPDATE rendezvous
        SET runs_done = $2, both_yes = $3, cost_usd = $4,
            status = 'decided', decided_at = now()
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
 * Does this pair clear the bar?
 *
 * A majority of a quorum. The majority is what makes it a repeatable observation
 * rather than one polite exchange; the quorum is what stops a dropped connection
 * turning five planned runs into a one-run coin toss that rounds up to certainty.
 */
export const passes = (bothYes: number, counted: number, planned = RUNS): boolean =>
  counted >= quorum(planned) && bothYes / counted > 0.5;
