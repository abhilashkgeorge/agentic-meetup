/**
 * The recap after a round, as the Matches screen words it: no count, no verdict.
 *
 * WHY (build list item 11): templates and the person's own shareable words only (server
 * tests/round-recap.test.ts builds it). This pins the phone's joining words and that the
 * old announcement's count is gone ("Your agent found 3 people").
 *
 * Negative controls, run 2026-09-25:
 *   - the topics line carrying how many topics            -> "no digit" fails
 *   - the announcement's `${round.met} people` put back   -> "no count" fails
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recapLines } from '../src/features/matches/recap';

const JUDGING = /\b(match(es|ed)?|chemistry|click(s|ed)?|compatib\w*|worth it|got on|get on|perfect|great fit)\b/i;

describe('the recap', () => {
  it('joins the server’s parts with words, adding no digit and no verdict', () => {
    const r = recapLines({
      went: 'Your agent went out and met someone new.',
      said: ['I cycle out of the city most weekends'],
      topics: ['Weekends', 'Food', 'Kids'],
      unsure: ['Kids'],
    });
    expect(r).toEqual({
      went: 'Your agent went out and met someone new.',
      saidIntro: 'It spoke for you in your own words:',
      said: ['I cycle out of the city most weekends'],
      topics: 'Your agents talked about weekends, food and kids.',
      unsure: 'It had to say "I don\'t know" about kids. Tell it, and it will know next time.',
    });
    for (const t of [r.saidIntro, r.topics, r.unsure]) {
      expect(t).not.toMatch(/\d/);
      expect(t).not.toMatch(JUDGING);
    }
  });

  it('says nothing it has nothing for', () => {
    expect(recapLines({ went: 'x', said: [], topics: [], unsure: [] }))
      .toEqual({ went: 'x', saidIntro: null, said: [], topics: null, unsure: null });
  });

  it('no count: the Matches screen shows the recap, and the old announcement lost its number', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'matches', 'matches-screen.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(src).toMatch(/recapLines\(round\.recap\)/);
    expect(src, 'the round announcement counts people again').not.toMatch(/\$\{round\.met\}/);
  });
});
