/**
 * Mapping a written dealbreaker through a typed model.
 *
 * THIS IS THE ONE ANSWER IN THE PRODUCT ALLOWED TO REMOVE PEOPLE, and a wrong mapping
 * is invisible: the person never sees who it took out and is never told why. So the
 * thresholds are the feature, not the model, and these are the tests of the
 * thresholds.
 *
 * NO MODEL IS CALLED. `llm.decide` is replaced with a function that returns whatever
 * the test wants, so what is measured here is our arithmetic on their numbers.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - drop the `field.confidence < FIELD_MIN` check -> "writes no rule when it is
 *     unsure which field" fails.
 *   - drop the "every value" guard -> "refuses a reading that excludes everybody"
 *     fails.
 *   - use every field's nouls instead of the chosen one's -> "keeps to the field it
 *     chose" fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MATCHABLE_PREDICATES } from '@clone/shared';
import type { Answer, DecideRequest, DecideResponse } from '../src/llm/port.js';
import { CORE_PREDICATES } from '../src/onboarding/questions.js';

const CTX = { tenantId: '00000000-0000-0000-0000-000000000001', userId: '00000000-0000-0000-0000-000000000002' };
const MODEL = 'typesafe:jev-latest' as const;

/** The last request the mapper made, so the questions themselves can be inspected. */
let asked: DecideRequest | null = null;
/** What the stub answers with, set per test. */
let reply: Record<string, Answer> = {};

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return {
    ...real,
    decideModel: () => MODEL,
    llm: {
      ...real.llm,
      decide: async (req: DecideRequest): Promise<DecideResponse> => {
        asked = req;
        return {
          answers: reply,
          usage: {
            inputTokens: 1000, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0,
            reasoningTokens: 0, provider: 'typesafe', modelId: 'jev-1.13.0',
            costUsd: 0.000042, latencyMs: 90,
          },
        };
      },
    },
  };
});

const { mapDealbreaker } = await import('../src/onboarding/dealbreaker.js');

const id = (predicate: string, value: string) =>
  `v__${predicate}__${value}`.replace(/[^A-Za-z0-9_]/g, '_');

const noul = (p: number): Answer => ({ kind: 'noul', p });
const choice = (c: string, confidence: number): Answer =>
  ({ kind: 'choice', choice: c, confidence, probabilities: { [c]: confidence } });

beforeEach(() => { asked = null; reply = {}; });
afterEach(() => { vi.clearAllMocks(); });

describe('the typed dealbreaker mapping', () => {
  it('asks about every field and every value it could ever store, in ONE request', async () => {
    reply = { field: choice('none_of_these', 1) };
    await mapDealbreaker(CTX, 'someone who talks through films');

    expect(asked, 'it never called the model').not.toBeNull();
    const questions = asked!.questions;
    // One choice over the fields...
    expect(questions.field?.kind).toBe('choice');
    const offered = Object.keys((questions.field as { options: Record<string, string> }).options);
    for (const p of MATCHABLE_PREDICATES) {
      // ...which are the five core cards and nothing else: a sentence may only write a
      // rule on a field every person in the pool has been asked (dealbreaker.ts).
      if (!CORE_PREDICATES.includes(p.name)) {
        expect(offered, `${p.name} is not a card and was offered`).not.toContain(p.name);
        expect(questions[id(p.name, p.values[0]!)], `${p.name} was asked about`).toBeUndefined();
        continue;
      }
      expect(offered).toContain(p.name);
      // ...and one yes/no per value, so the whole vocabulary is covered by one call.
      for (const v of p.values) {
        expect(questions[id(p.name, v)]?.kind, `no question about ${p.name}=${v}`).toBe('noul');
      }
    }
    // The person's sentence is the state, never bent into an instruction.
    expect(asked!.state).toBe('someone who talks through films');
  });

  it('closes a sure "rarely" upward to every smoker, like the prose path', async () => {
    reply = {
      field: choice('smoking', 0.95),
      [id('smoking', 'rarely')]: noul(0.9),
      [id('smoking', 'daily')]: noul(0.2),
    };
    const out = await mapDealbreaker(CTX, 'no smokers at all');
    expect(out.excludes).toEqual(['rarely', 'sometimes', 'often', 'daily']);
  });

  it('writes nothing on a field that is not a card, however sure it is', async () => {
    reply = { field: choice('drugs', 0.99), [id('drugs', 'daily')]: noul(0.99) };
    const out = await mapDealbreaker(CTX, 'no drug users');
    expect(out.predicate).toBeNull();
  });

  it('writes the rule when it is sure about the field and the values', async () => {
    reply = {
      field: choice('smoking', 0.95),
      [id('smoking', 'daily')]: noul(0.98),
      [id('smoking', 'often')]: noul(0.92),
      [id('smoking', 'sometimes')]: noul(0.4),
      [id('smoking', 'rarely')]: noul(0.1),
      [id('smoking', 'never')]: noul(0.0),
    };
    const out = await mapDealbreaker(CTX, 'I could not be with a smoker');
    expect(out.predicate).toBe('smoking');
    // Catalogue order, not the order they were answered in: the rule is a set and
    // the column it lands in is a set.
    expect([...out.excludes].sort()).toEqual(['daily', 'often']);
    // Charged through our own meter like every other call.
    expect(out.costUsd).toBeGreaterThan(0);
  });

  it('writes no rule when it is unsure which field', async () => {
    reply = {
      field: choice('smoking', 0.4),
      [id('smoking', 'daily')]: noul(0.99),
    };
    const out = await mapDealbreaker(CTX, 'someone a bit much');
    expect(out.predicate).toBeNull();
    expect(out.excludes).toEqual([]);
    expect(out.because).toMatch(/unsure/);
  });

  it('writes no rule from a sentence it is unsure about', async () => {
    // The field is clear, no single value is. A filter built on a maybe removes real
    // people for no reason, and they never find out.
    reply = {
      field: choice('diet', 0.9),
      [id('diet', 'vegan')]: noul(0.55),
      [id('diet', 'vegetarian')]: noul(0.5),
    };
    const out = await mapDealbreaker(CTX, 'I think diet stuff might matter to me?');
    expect(out.predicate).toBeNull();
  });

  it('refuses a reading that excludes everybody', async () => {
    // "I could not be with anybody" is a misreading, not a preference. Stored, it
    // would empty the pool and look exactly like having no matches.
    const diet = MATCHABLE_PREDICATES.find((p) => p.name === 'diet')!;
    reply = { field: choice('diet', 0.99) };
    for (const v of diet.values) reply[id('diet', v)] = noul(0.99);

    const out = await mapDealbreaker(CTX, 'anybody, really');
    expect(out.predicate).toBeNull();
    expect(out.because).toMatch(/every value/);
  });

  it('keeps to the field it chose, whatever the other fields answered', async () => {
    // Every noul is answered in one request, including for fields the sentence was
    // not about. A stray high probability on an unrelated one must not write a second
    // rule out of a single sentence.
    reply = {
      field: choice('diet', 0.9),
      [id('diet', 'vegan')]: noul(0.95),
      [id('smoking', 'daily')]: noul(0.99),
      [id('wants_children', 'no')]: noul(0.99),
    };
    const out = await mapDealbreaker(CTX, 'I could not be with a vegan');
    expect(out.predicate).toBe('diet');
    expect(out.excludes).toEqual(['vegan']);
  });

  it('says nothing rather than something when the sentence is about nothing we match on', async () => {
    reply = { field: choice('none_of_these', 1) };
    const out = await mapDealbreaker(CTX, 'someone who talks through films');
    expect(out.predicate).toBeNull();
    expect(out.excludes).toEqual([]);
  });
});
