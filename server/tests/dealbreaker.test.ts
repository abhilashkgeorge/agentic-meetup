/**
 * "Who could you absolutely not spend time with?"
 *
 * One of two answers in the product that can remove people from somebody's pool -- the
 * other is a narrowed Who's-fine row on a core card -- and the only one a model reads,
 * which is why the mapping from a sentence to a rule is the careful part. What is pinned
 * here is mostly RESTRAINT: a vague sentence must map to nothing, an invented value
 * must be dropped, and a failure must still keep the sentence.
 */
import { describe, expect, it, vi } from 'vitest';

const stub = vi.hoisted(() => ({ parsed: {} as unknown, instructions: '' }));

vi.mock('../src/llm/index.js', () => ({
  modelFor: () => 'google:gemini-3.5-flash-lite',
  // The prose path, which is what this file is about. `null` is also the default:
  // the typed model is off until somebody sets DECIDE_MODEL, and this pins that
  // turning it off returns the behaviour below exactly. See dealbreaker-typed.test.ts
  // for the other path.
  decideModel: () => null,
  llm: {
    complete: async (req: { instructions: string }) => {
      // Kept so a test can read the prompt the mapper actually sent.
      stub.instructions = req.instructions;
      return {
        text: '', parsed: stub.parsed,
        usage: {
          inputTokens: 0, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0,
          reasoningTokens: 0, provider: 'google', modelId: 'x', costUsd: 0, latencyMs: 0,
        },
      };
    },
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

describe('"no smokers", and every other sentence that names a frequency', () => {
  // (h). THE BUG: the prompt's own worked example taught "Someone who smokes" as
  // {often, sometimes}, so a model that followed it wrote `smoking not_in [often,
  // sometimes]` -- and daily smokers, the most smoking anybody does, passed "no
  // smokers". Two fixes, and both are pinned: the example now names every level of
  // smoking, and code closes whatever the model says upward, because a prompt line is
  // not a guard.
  it('teaches "someone who smokes" as rarely, sometimes, often and daily', async () => {
    stub.parsed = { predicate: null, excludes: [], because: 'x' };
    await mapDealbreaker(ctx, 'No smokers.');
    expect(stub.instructions).toContain('"Someone who smokes" is smoking: exclude rarely, sometimes, often, daily.');
  });

  it('closes a level upward: "rarely" means every smoker', async () => {
    stub.parsed = { predicate: 'smoking', excludes: ['rarely'], because: 'x' };
    const m = await mapDealbreaker(ctx, 'No smokers.');
    expect(m.excludes).toEqual(['rarely', 'sometimes', 'often', 'daily']);
  });

  it('no longer lets a daily smoker through the old example\'s answer', async () => {
    stub.parsed = { predicate: 'smoking', excludes: ['often', 'sometimes'], because: 'x' };
    const m = await mapDealbreaker(ctx, 'Someone who smokes.');
    expect(m.excludes).toEqual(['sometimes', 'often', 'daily']);
  });

  it('closes drinking the same way', async () => {
    stub.parsed = { predicate: 'drinking', excludes: ['often'], because: 'x' };
    const m = await mapDealbreaker(ctx, 'Heavy drinkers.');
    expect(m.excludes).toEqual(['often', 'daily']);
  });

  it('does not close "never" upward: not doing it is not a level of doing it', async () => {
    // "I couldn't be with someone who doesn't drink" is a real rule and a narrow one.
    // Closed upward it would exclude everybody who answered.
    stub.parsed = { predicate: 'drinking', excludes: ['never'], because: 'x' };
    const m = await mapDealbreaker(ctx, 'A teetotaller.');
    expect(m.predicate).toBe('drinking');
    expect(m.excludes).toEqual(['never']);
  });

  it('refuses a reading that closes up to every value', async () => {
    stub.parsed = { predicate: 'smoking', excludes: ['never', 'rarely'], because: 'x' };
    const m = await mapDealbreaker(ctx, 'anybody, really');
    expect(m.predicate).toBeNull();
    expect(m.excludes).toEqual([]);
  });
});

describe('what a sentence may land on', () => {
  it('only the five core card fields, whatever the model says', async () => {
    // A rule on a field nobody is asked passes nearly everybody as unknown and removes
    // the few who happened to mention it. These three are matchable and are not cards.
    for (const predicate of ['drugs', 'exercise_habit', 'relationship_intent']) {
      stub.parsed = { predicate, excludes: ['daily', 'casual'], because: 'x' };
      const m = await mapDealbreaker(ctx, 'whatever');
      expect(m.predicate, `${predicate} became a rule`).toBeNull();
      expect(m.excludes).toEqual([]);
    }
  });

  it('shows the model only those five', async () => {
    stub.parsed = { predicate: null, excludes: [], because: 'x' };
    await mapDealbreaker(ctx, 'whatever');
    const fields = [...stub.instructions.matchAll(/^- (\w+):/gm)].map((m) => m[1]);
    expect(fields.sort()).toEqual(['diet', 'drinking', 'monogamy_stance', 'smoking', 'wants_children']);
  });
});

describe('the question itself', () => {
  it('is asked straight after the cards, and asks for a sentence', async () => {
    // After the core on purpose: it is the only question in the flow that asks for
    // effort, and effort is cheap once somebody has answered eight things. First is
    // where a blank box makes people leave. Before the optional chips, because the
    // only rule it can write is on one of the cards just answered. Since 2026-09-25
    // "the cards" are the five and then the optional faith card.
    const { CORE, GATING, OPTIONAL_CARDS, QUESTIONS } = await import('../src/onboarding/questions.js');
    const { nextQuestion } = await import('../src/onboarding/next-question.js');
    const free = QUESTIONS.filter((q) => q.kind === 'free');

    expect(free).toHaveLength(1);
    expect(free[0]!.id).toBe('q-dealbreaker');
    expect(free[0]!.tier).toBe('free');
    expect(free[0]!.options).toEqual([]);

    const fakeDb = { query: async () => ({ rows: [], rowCount: 0 }) } as never;
    expect((await nextQuestion(fakeDb, 'u', new Set([...GATING, ...CORE]), []))?.question.id).toBe('card-faith');
    const next = await nextQuestion(fakeDb, 'u', new Set([...GATING, ...CORE, ...OPTIONAL_CARDS]), []);
    expect(next?.question.id).toBe('q-dealbreaker');
  });

  it('comes before the optional chips even when a pool can score them', async () => {
    // The test above cannot see this order. With an empty pool every chip scores 0,
    // so the OLD order -- scored chips first, the sentence as the fallback -- also
    // returned the sentence. Here there are candidates, and every optional field
    // splits them evenly (splits = 1, well over the 0.15 bar), so a chip is a real
    // contender and only the order can put the sentence first.
    const { CORE, GATING, OPTIONAL_CARDS } = await import('../src/onboarding/questions.js');
    const { nextQuestion } = await import('../src/onboarding/next-question.js');
    const evenSplit = { query: async () => ({ rows: [{ v: 'x', n: '5' }, { v: 'y', n: '5' }], rowCount: 2 }) } as never;

    const next = await nextQuestion(evenSplit, 'u', new Set([...GATING, ...CORE, ...OPTIONAL_CARDS]), ['a', 'b']);
    expect(next?.question.id, 'an optional chip jumped the sentence').toBe('q-dealbreaker');

    // And the pool really does score them: with the sentence answered, a chip comes
    // next, chosen by its split -- so the assertion above was not passing on nulls.
    const after = await nextQuestion(evenSplit, 'u', new Set([...GATING, ...CORE, ...OPTIONAL_CARDS, 'q-dealbreaker']), ['a', 'b']);
    expect(after?.question.tier).toBe('optional');
    expect(after?.splits).toBe(1);
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
