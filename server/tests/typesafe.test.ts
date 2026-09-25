/**
 * The System One adapter, and the two decisions routed through it.
 *
 * NO MODEL IS CALLED. `fetch` is replaced, so every request body asserted here is the
 * one the adapter would really have sent, and nothing is spent. That matters more than
 * usual for this adapter: it is early-access, one vendor, and the whole point of
 * adding it is to find out whether it is any good -- which means it must be possible
 * to change it without paying to find out what broke.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - price output at anything above 0 in caps.ts -> "output tokens are free" fails.
 *   - return `noul: 0` for a missing answer instead of 0.5 -> "a missing answer is
 *     not a no" fails.
 *   - drop the `choice in options` check -> "an answer outside the options is not
 *     trusted" fails.
 *   - lower VALUE_MIN to 0 in dealbreaker.ts -> "writes no rule from a sentence it is
 *     unsure about" fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/env.js';
import { UnsupportedCapability, capabilities } from '../src/llm/caps.js';
import * as typesafe from '../src/llm/adapters/typesafe.js';
import type { DecideRequest } from '../src/llm/port.js';

const MODEL = 'typesafe:jev-latest' as const;

interface Sent { url: string; init: RequestInit; body: Record<string, unknown> }

let sent: Sent[] = [];
const original = globalThis.fetch;

/** Stand in for their endpoint. `answers` is whatever the test wants back. */
function stubFetch(answers: Record<string, unknown>, opts: { status?: number; usage?: unknown } = {}) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), init, body: JSON.parse(String(init.body)) });
    const status = opts.status ?? 200;
    return {
      ok: status < 400,
      status,
      json: async () => ({
        model: 'jev-1.13.0',
        answers,
        usage: opts.usage ?? { input_tokens: 1_000_000, output_tokens: 500_000 },
      }),
      text: async () => 'boom',
    };
  }) as unknown as typeof fetch;
}

// `env` is parsed once at import, so setting process.env here would change nothing.
// The parsed object is what the adapter reads, and it is what is restored.
const realKey = env.TYPESAFE_API_KEY;
beforeEach(() => {
  sent = [];
  env.TYPESAFE_API_KEY = 'test-key';
});
afterEach(() => {
  globalThis.fetch = original;
  env.TYPESAFE_API_KEY = realKey;
  vi.restoreAllMocks();
});

const ask = (questions: DecideRequest['questions']): DecideRequest => ({
  state: 'someone who will not stop talking about crypto',
  questions,
  tenantId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
});

describe('the System One adapter', () => {
  it('sends the shape their API documents', async () => {
    stubFetch({ q: { type: 'noul', noul: 0.9 } });
    await typesafe.decide(ask({ q: { kind: 'noul', instructions: 'They smoke.' } }), MODEL);

    expect(sent).toHaveLength(1);
    const { url, init, body } = sent[0]!;
    expect(url).toContain('/v1/systemone');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    // The model id, not our `provider:id` reference -- they have never heard of ours.
    expect(body.model).toBe('jev-latest');
    expect(body.state).toContain('crypto');
    expect(body.questions).toEqual({ q: { type: 'noul', instructions: 'They smoke.' } });
  });

  it('spells a choice as criteria, which is what they call the options', async () => {
    stubFetch({ q: { type: 'choice', choice: 'a', confidence: 1, probabilities: { a: 1, b: 0 } } });
    await typesafe.decide(
      ask({ q: { kind: 'choice', instructions: 'Which?', options: { a: 'first', b: 'second' } } }),
      MODEL,
    );
    expect(sent[0]!.body.questions).toEqual({
      q: { type: 'choice', instructions: 'Which?', criteria: { a: 'first', b: 'second' } },
    });
  });

  it('charges for input and nothing for output, from our own price table', async () => {
    // THE NUMBER THAT MADE THIS WORTH TRYING. Exactly one million input tokens and
    // half a million output, so the arithmetic is readable: $0.042 and not a cent
    // more. If output ever stops being free this test is what says so.
    stubFetch({ q: { type: 'noul', noul: 0.5 } });
    const res = await typesafe.decide(ask({ q: { kind: 'noul', instructions: 'x' } }), MODEL);
    expect(capabilities(MODEL).price.output, 'output tokens are free').toBe(0);
    expect(res.usage.costUsd).toBeCloseTo(0.042, 6);
    expect(res.usage.provider).toBe('typesafe');
  });

  it('reads a missing answer as no information, never as a no', async () => {
    // 0 is a confident NO in every question this asks. An answer that did not arrive
    // must not arrive as one -- on the dealbreaker path that is the difference
    // between no rule and a rule written backwards.
    stubFetch({ q: { type: 'noul' } });
    const res = await typesafe.decide(ask({ q: { kind: 'noul', instructions: 'x' } }), MODEL);
    expect(res.answers.q).toEqual({ kind: 'noul', p: 0.5 });
  });

  it('does not trust an answer outside the options it was given', async () => {
    stubFetch({ q: { type: 'choice', choice: 'invented', confidence: 0.99, probabilities: {} } });
    const res = await typesafe.decide(
      ask({ q: { kind: 'choice', instructions: 'Which?', options: { a: 'first' } } }),
      MODEL,
    );
    expect(res.answers.q).toMatchObject({ kind: 'choice', choice: '', confidence: 0 });
  });

  it('ignores an answer to a question it never asked', async () => {
    stubFetch({ q: { type: 'noul', noul: 1 }, stowaway: { type: 'noul', noul: 1 } });
    const res = await typesafe.decide(ask({ q: { kind: 'noul', instructions: 'x' } }), MODEL);
    expect(Object.keys(res.answers)).toEqual(['q']);
  });

  it('marks a rate limit retryable and everything else not', async () => {
    stubFetch({}, { status: 429 });
    await expect(typesafe.decide(ask({ q: { kind: 'noul', instructions: 'x' } }), MODEL))
      .rejects.toThrow(/retryable/);
    stubFetch({}, { status: 422 });
    await expect(typesafe.decide(ask({ q: { kind: 'noul', instructions: 'x' } }), MODEL))
      .rejects.toThrow(/422/);
  });

  it('refuses to write text rather than writing something approximate', async () => {
    // Rule 2 at its plainest. There is no degraded version of "write me a sentence"
    // for a model that writes none, and the conversation must never land here.
    expect(() => typesafe.complete({} as never, MODEL)).toThrow(UnsupportedCapability);
    expect(() => typesafe.stream({} as never, MODEL)).toThrow(UnsupportedCapability);
    expect(capabilities(MODEL).maxOutput, 'it generates no tokens').toBe(0);
  });

  it('needs a key before it will reach for the network', async () => {
    env.TYPESAFE_API_KEY = '';
    globalThis.fetch = (() => { throw new Error('should not have been called'); }) as never;
    await expect(typesafe.decide(ask({ q: { kind: 'noul', instructions: 'x' } }), MODEL))
      .rejects.toThrow(/TYPESAFE_API_KEY/);
  });
});
