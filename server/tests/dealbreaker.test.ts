/**
 * "Who could you absolutely not spend time with?"
 *
 * The only answer in the product allowed to remove people from somebody's pool, which
 * is why the mapping from a sentence to a rule is the careful part. What is pinned
 * here is mostly RESTRAINT: a vague sentence must map to nothing, an invented value
 * must be dropped, and a failure must still keep the sentence.
 */
import { describe, expect, it, vi } from 'vitest';

const stub = vi.hoisted(() => ({ parsed: {} as unknown }));

vi.mock('../src/llm/index.js', () => ({
  modelFor: () => 'google:gemini-3.5-flash-lite',
  llm: {
    complete: async () => ({
      text: '', parsed: stub.parsed,
      usage: {
        inputTokens: 0, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0,
        reasoningTokens: 0, provider: 'google', modelId: 'x', costUsd: 0, latencyMs: 0,
      },
    }),
  },
}));

const { mapDealbreaker } = await import('../src/onboarding/dealbreaker.js');
const ctx = { tenantId: 't', userId: 'u' };

describe('mapping a sentence to a filter', () => {
  it('maps what is plainly there', async () => {
    stub.parsed = { predicate: 'smoking', excludes: ['often', 'daily'], because: 'said smokers' };
    const m = await mapDealbreaker(ctx, 'Anyone who smokes.');
    expect(m.predicate).toBe('smoking');
    expect(m.excludes).toEqual(['often', 'daily']);
  });

  it('maps nothing when the sentence is about something no field holds', async () => {
    // "Someone boring" is a real feeling and not a filter. Inventing one here removes
    // real people from somebody's matches, and neither of them ever finds out.
    stub.parsed = { predicate: null, excludes: [], because: 'not a field' };
    const m = await mapDealbreaker(ctx, 'Someone boring.');
    expect(m.predicate).toBeNull();
    expect(m.excludes).toEqual([]);
  });

  it('drops a value the field does not have', async () => {
    // A model naming a value that is not on the list is a model guessing, and this is
    // the one rule that deletes people.
    stub.parsed = { predicate: 'diet', excludes: ['vegan', 'carnivore-only'], because: 'x' };
    const m = await mapDealbreaker(ctx, 'I could not date a vegan.');
    expect(m.excludes).toEqual(['vegan']);
  });

  it('maps nothing when every value it named was invented', async () => {
    stub.parsed = { predicate: 'diet', excludes: ['raw-food-only'], because: 'x' };
    const m = await mapDealbreaker(ctx, 'nonsense');
    expect(m.predicate).toBeNull();
  });

  it('maps nothing when the field itself is not one we match on', async () => {
    // Religion and politics are deliberately absent from the mappable list: they can
    // still decide a match through the ordinary preference path, where the person
    // picked the value from a list rather than a model reading it out of a sentence.
    stub.parsed = { predicate: 'religion', excludes: ['none'], because: 'x' };
    const m = await mapDealbreaker(ctx, 'Someone not religious.');
    expect(m.predicate).toBeNull();
  });

  it('survives an answer it cannot parse at all', async () => {
    stub.parsed = { wrong: 'shape' };
    const m = await mapDealbreaker(ctx, 'whatever');
    expect(m.predicate).toBeNull();
  });
});

describe('the question itself', () => {
  it('is asked last, and asks for a sentence', async () => {
    // Last on purpose: it is the only question in the flow that asks for effort, and
    // effort is cheap once somebody has answered five things and watched the number of
    // people move. First is where a blank box makes people leave.
    const { QUESTIONS } = await import('../src/onboarding/questions.js');
    const free = QUESTIONS.filter((q) => q.kind === 'free');

    expect(free).toHaveLength(1);
    expect(free[0]!.id).toBe('q-dealbreaker');
    expect(QUESTIONS[QUESTIONS.length - 1]!.id).toBe('q-dealbreaker');
    expect(free[0]!.options).toEqual([]);
  });

  it('is never one of the questions that gate the pool', async () => {
    // A gating question has to be answerable by everybody; a blank box is not.
    const { GATING } = await import('../src/onboarding/questions.js');
    expect(GATING).not.toContain('q-dealbreaker');
  });
});

describe('when it gets asked', () => {
  it('is not dropped for scoring zero', async () => {
    // It would have been. Questions are ranked by how well their answers divide the
    // pool, `dealbreaker` is not a field the pool has, so it scored zero, fell below
    // the threshold, and the interview ended without ever asking it -- a question
    // written, wired and shipped that nobody would ever have seen.
    const { nextQuestion } = await import('../src/onboarding/next-question.js');

    // Every chip question already answered, so only the sentence is left.
    const { QUESTIONS } = await import('../src/onboarding/questions.js');
    const answered = new Set(QUESTIONS.filter((q) => q.kind !== 'free').map((q) => q.id));

    const fakeDb = { query: async () => ({ rows: [], rowCount: 0 }) } as never;
    const next = await nextQuestion(fakeDb, 'u', answered, []);

    expect(next?.question.id).toBe('q-dealbreaker');
  });
});

describe('the questions that cannot be skipped', () => {
  it('names exactly the three the pool cannot run without', async () => {
    // The candidate query filters on gender, who they want to meet, and what they are
    // here for. Skip one and the agent never leaves the building, having told the
    // person setup was finished.
    const { GATING } = await import('../src/onboarding/questions.js');
    expect([...GATING].sort()).toEqual(['q-gender', 'q-intent', 'q-seeking']);
  });

  it('marks them required so the app can hide the skip button', async () => {
    const { BY_ID, GATING } = await import('../src/onboarding/questions.js');
    for (const id of GATING) {
      expect(BY_ID.get(id), id).toBeDefined();
      // Every gating question must have options: a required question somebody cannot
      // answer is a dead end rather than a gate.
      expect(BY_ID.get(id)!.options.length, id).toBeGreaterThan(1);
    }
  });

  it('asks them before anything optional', async () => {
    const { nextQuestion } = await import('../src/onboarding/next-question.js');
    const fakeDb = { query: async () => ({ rows: [], rowCount: 0 }) } as never;
    const first = await nextQuestion(fakeDb, 'u', new Set(), []);
    const { GATING } = await import('../src/onboarding/questions.js');
    expect(GATING).toContain(first!.question.id);
  });
});
