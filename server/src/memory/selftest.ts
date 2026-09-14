/**
 * The clone answers as its owner. The owner says whether that is them.
 *
 * The smallest complete version of the product: the clone speaks in someone's place,
 * and the one person who cannot be fooled about the answer judges it. When agents
 * start meeting other agents, that is the same act with the stakes raised.
 *
 * It is also the ONLY judge. Friends do not grade anybody's clone -- the agent is
 * built by its owner, for its owner, and nobody else's opinion of them goes in.
 *
 * Every graded answer is an eval case: question, answer, verdict, correction. The
 * corpus fills as a by-product of a screen people want to use.
 */
import type { PoolClient } from 'pg';
import { llm, modelFor } from '../llm/index.js';
import { modelIdOf } from '../llm/caps.js';
import { currentState } from './facts.js';
import { coreProfileText, voiceText } from './profile.js';

export const SELFTEST_PROMPT_VERSION = '2026-09-10.selftest.1';

/** How many must pass, out of how many, before the clone may represent its owner. */
export const PASS_MARK = 3;
export const TEST_SIZE = 5;
/** Owner-origin facts needed before the test is even worth running. */
export const MIN_FACTS = 8;

/**
 * Everyday questions with no right answer, only a characteristic one. They probe
 * VOICE and JUDGEMENT rather than recall: "where do you live" tests whether a
 * database row was read, which is not in doubt and is not what fails in the wild.
 * "How do you turn down an invitation" tests whether it sounds like the person, and
 * that is the thing a friend will catch in one line.
 */
const PROBES = [
  'A friend asks what you have been up to lately. What do you say?',
  'Someone invites you to a thing on Saturday you do not want to go to. How do you say no?',
  'What annoyed you this week?',
  'A friend asks for a restaurant recommendation. What do you tell them?',
  'Someone asks what you do for work. How do you describe it?',
  'A friend cancels on you last minute. What do you write back?',
  'What are you looking forward to?',
  'Someone asks if you are free tomorrow. You are not. What do you say?',
  'What is something you have changed your mind about?',
  'A friend is having a bad day and messages you. What do you send?',
];

const SYSTEM = `You are answering AS this person, in a message to a friend. You are not an assistant and you must not sound like one.

Rules:
- Write what THEY would write. Their length, their punctuation, their habits.
- Most people write short. If their voice notes say short, be short. One line is often right.
- Use only what you actually know about them. Never invent a fact to make the answer richer.
- If you do not know something the answer needs, write around it the way a person does — vague is human, invented is not.
- No greetings, no sign-offs, no "as an AI". Just the message.`;

export interface SelfTestItem {
  id: string;
  question: string;
  answer: string;
}

/** Which probe to use next: the one this person has been asked least recently. */
async function pickQuestion(c: PoolClient, userId: string): Promise<string> {
  const { rows } = await c.query<{ question: string }>(
    `SELECT question FROM self_tests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [userId],
  );
  const used = new Set(rows.map((r) => r.question));
  const fresh = PROBES.filter((p) => !used.has(p));
  const pool = fresh.length ? fresh : PROBES;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

export async function nextSelfTest(
  c: PoolClient,
  ctx: { tenantId: string; userId: string },
): Promise<SelfTestItem | null> {
  const facts = await currentState(c, ctx.userId);
  if (facts.length === 0) return null;

  const question = await pickQuestion(c, ctx.userId);
  const profile = await coreProfileText(c, ctx.userId);
  const voice = await voiceText(c, ctx.userId);

  const model = modelFor('chat');
  const res = await llm.complete(
    {
      task: 'chat',
      instructions: SYSTEM,
      messages: [
        ...(profile ? [{ role: 'user' as const, content: `About them:\n${profile}` }] : []),
        {
          role: 'user' as const,
          content:
            `True right now:\n` +
            facts.map((f) => `- ${f.predicate.replace(/_/g, ' ')}: ${f.objectText}`).join('\n'),
        },
        ...(voice
          ? [{ role: 'user' as const, content: `How they write. Match it exactly:\n${voice}` }]
          : []),
        { role: 'user' as const, content: question },
      ],
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      // Short by design. A long answer is itself a tell -- almost nobody writes three
      // paragraphs to a friend, so length alone would fail the test.
      maxOutputTokens: 300,
      thinking: false,
      cache: [{ scope: 'instructions', ttl: '5m' }],
    },
    model,
  );

  const answer = res.text.trim();
  if (!answer) return null;

  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO self_tests (tenant_id, user_id, question, answer, model, cost_usd)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [ctx.tenantId, ctx.userId, question, answer, modelIdOf(model), res.usage.costUsd],
  );

  return { id: rows[0]!.id, question, answer };
}

/**
 * Grade one. A correction is the highest-quality input this system can receive: it is
 * first-party, it is about a specific failure, and the person volunteered it -- so it
 * commits as an owner assertion rather than joining the staged pile.
 */
export async function gradeSelfTest(
  c: PoolClient,
  ctx: { tenantId: string; userId: string },
  id: string,
  verdict: 'me' | 'not_me',
  correction?: string,
): Promise<boolean> {
  const { rowCount } = await c.query(
    `UPDATE self_tests SET verdict = $3, correction = $4, graded_at = now()
      WHERE id = $1 AND user_id = $2 AND verdict IS NULL`,
    [id, ctx.userId, verdict, correction?.slice(0, 2000) ?? null],
  );
  if (!rowCount) return false;

  if (verdict === 'not_me' && correction?.trim()) {
    // Filed as an open question rather than parsed into a predicate here. Guessing a
    // predicate from free text is exactly the "a guess is never a fact" failure this
    // codebase already fixed once; the extraction pass will read it properly.
    await c.query(
      `INSERT INTO fact_conflicts (tenant_id, user_id, fact_a_id, kind, clarifying_question)
       VALUES ($1,$2,NULL,'gap',$3)
       ON CONFLICT DO NOTHING`,
      [ctx.tenantId, ctx.userId, `You said: "${correction.trim().slice(0, 300)}" — tell me more?`],
    );
  }
  return true;
}

export interface Readiness {
  ready: boolean;
  passed: number;
  graded: number;
  /** Named in plain English, never a percentage. A number invites gaming a score. */
  missing: string[];
}

/**
 * The gate. Stated as the named missing thing, never as a score -- a percentage turns
 * self-disclosure into a form to max out, which is the product this design exists to
 * avoid.
 */
export async function readiness(c: PoolClient, userId: string): Promise<Readiness> {
  const { rows: f } = await c.query<{ n: string }>(
    `SELECT count(*) AS n FROM facts
      WHERE user_id = $1 AND status = 'active' AND valid_to IS NULL AND origin_class = 'owner'`,
    [userId],
  );
  const factCount = Number(f[0]!.n);

  const { rows: v } = await c.query<{ n: string }>(
    `SELECT count(*) AS n FROM core_profile WHERE user_id = $1 AND block_name = 'voice'`,
    [userId],
  );
  const hasVoice = Number(v[0]!.n) > 0;

  // The most recent run only. An old failure should not follow a clone that improved.
  const { rows: g } = await c.query<{ verdict: string }>(
    `SELECT verdict FROM self_tests
      WHERE user_id = $1 AND verdict IS NOT NULL
      ORDER BY graded_at DESC LIMIT $2`,
    [userId, TEST_SIZE],
  );
  const passed = g.filter((r) => r.verdict === 'me').length;

  const missing: string[] = [];
  if (!hasVoice) missing.push('It has not heard how you write. Import one chat.');
  if (factCount < MIN_FACTS) {
    missing.push(`It knows ${factCount} things about you. It needs ${MIN_FACTS}.`);
  }
  if (g.length < TEST_SIZE) {
    missing.push(`Test it ${TEST_SIZE - g.length} more time${TEST_SIZE - g.length === 1 ? '' : 's'}.`);
  } else if (passed < PASS_MARK) {
    missing.push(`It got ${passed} of ${TEST_SIZE} right. It needs ${PASS_MARK}.`);
  }

  return { ready: missing.length === 0, passed, graded: g.length, missing };
}
