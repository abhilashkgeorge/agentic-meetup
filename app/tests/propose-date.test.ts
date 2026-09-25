/**
 * "Propose this date" in the chat: shown while there is an idea nobody has proposed,
 * and the phone sends only the message's id -- never words.
 *
 * WHY (build list item 7): the button sends the agents' date idea as a normal chat
 * message from the person, and the agent never schedules. The server writes the words
 * from the checked idea (server tests/propose-date.test.ts); this pins the phone's half:
 * it cannot add a day, a time or anything else, because it sends no text at all.
 *
 * Negative controls, run 2026-09-25:
 *   - proposeDate sending the idea as `text` too        -> "sends only the id" fails
 *   - showDateIdea ignoring `proposed`                   -> "hidden once proposed" fails
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/env', () => ({ getApiBase: () => 'http://api.test' }));

import { proposeDate } from '../src/lib/api';
import { showDateIdea } from '../src/features/dm/date-idea';

describe('the date idea card', () => {
  it('shows while there is an idea nobody has proposed, hidden once proposed', () => {
    expect(showDateIdea({ idea: 'Sunrise walk in Cubbon Park', proposed: false })).toBe(true);
    expect(showDateIdea({ idea: 'Sunrise walk in Cubbon Park', proposed: true })).toBe(false);
    expect(showDateIdea({ idea: null, proposed: false })).toBe(false);
    expect(showDateIdea(null)).toBe(false);
  });
});

describe('proposeDate', () => {
  const calls: { url: string; body: unknown }[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ message: {} }) };
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sends only the id: the server writes the words', async () => {
    await proposeDate('t.sig', 'r-1', 'm-1');
    expect(calls).toEqual([{ url: 'http://api.test/v1/conversations/r-1/date', body: { messageId: 'm-1' } }]);
  });
});
