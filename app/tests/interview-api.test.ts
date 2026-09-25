/**
 * answerQuestion sends the Who's-fine choice.
 *
 * WHAT WAS WRONG. The server now refuses a core card without `whoFine` (400
 * `who_fine_required`), and the app's answerQuestion took four arguments and posted
 * `{ questionId, values, text }`. A card answered on the phone would have been refused
 * every time, and the screen would have sat on the same card for ever.
 *
 * HOW. The real module, with `fetch` stubbed and the server address module replaced
 * (it reads expo-constants, which does not load under node). What is checked is the
 * body that would go over the wire.
 *
 * Negative control, run 2026-09-23: put back the old four-argument answerQuestion that
 * posts `{ questionId, values, text }` -> "sends whoFine" fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/env', () => ({ getApiBase: () => 'http://api.test' }));

import { answerQuestion } from '../src/lib/api';

describe('answerQuestion', () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return { ok: true, json: async () => ({ ok: true, ready: false, missing: [], mapped: null }) };
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sends whoFine for a core card: an only-list', async () => {
    await answerQuestion('t.sig', 'card-smoking', ['never'], undefined, { only: ['never', 'rarely'] });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://api.test/v1/interview/answer');
    expect(calls[0]!.body).toMatchObject({
      questionId: 'card-smoking', values: ['never'], whoFine: { only: ['never', 'rarely'] },
    });
  });

  it('sends whoFine for a core card: anyone, with the You row declined', async () => {
    await answerQuestion('t.sig', 'card-kids', [], undefined, { anyone: true });
    expect(calls[0]!.body).toMatchObject({ questionId: 'card-kids', values: [], whoFine: { anyone: true } });
  });

  it('sends no whoFine key at all for any other question', async () => {
    await answerQuestion('t.sig', 'q-gender', ['man']);
    expect(calls[0]!.body).not.toHaveProperty('whoFine');
  });
});
