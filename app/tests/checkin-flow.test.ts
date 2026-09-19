/**
 * The check-in walks in one order, skips nothing that counts, and offers help at
 * the one moment it should.
 */
import { describe, expect, it } from 'vitest';
import { again, answer, pastReportOffer, safety, start, stepsLeft, submission } from '../src/features/dm/checkin-flow';

const Q = [
  { key: 'photos', text: 'Did they look like their photos?', identity: true },
  { key: 'age', text: 'Did they seem about 30?', identity: true },
  { key: 'tag:climbing', text: 'Did climbing come up?', identity: false },
];

describe('the check-in', () => {
  it('asks the questions in order, then safety, then again, then is done', () => {
    let f = start(Q);
    expect(f.step).toEqual({ kind: 'question', index: 0 });
    f = answer(f, 'yes');
    f = answer(f, 'no');
    f = answer(f, 'unsure');
    expect(f.step).toEqual({ kind: 'safety' });
    expect(submission(f), 'nothing is sent before safety is answered').toBeNull();
    f = safety(f, true);
    expect(f.step).toEqual({ kind: 'again' });
    f = again(f, true);
    expect(f.step).toEqual({ kind: 'done' });
    expect(submission(f)).toEqual({ answers: { photos: 'yes', age: 'no', 'tag:climbing': 'unsure' }, feltSafe: true, seeAgain: true });
  });

  it('cannot skip a question: an out-of-turn transition changes nothing', () => {
    let f = start(Q);
    expect(safety(f, true)).toBe(f);
    expect(again(f, true)).toBe(f);
    f = answer(f, 'yes');
    expect(f.step).toEqual({ kind: 'question', index: 1 });
  });

  it('offers to block or report when they did not feel safe, then carries on', () => {
    let f = start([]);
    expect(f.step).toEqual({ kind: 'safety' });
    f = safety(f, false);
    expect(f.step).toEqual({ kind: 'offer_report' });
    expect(again(f, false), 'again is not reachable from the offer').toBe(f);
    f = pastReportOffer(f);
    expect(f.step).toEqual({ kind: 'again' });
    f = again(f, null);
    expect(submission(f)).toEqual({ answers: {}, feltSafe: false, seeAgain: null });
  });

  it('counts the steps left for the strip', () => {
    let f = start(Q);
    expect(stepsLeft(f)).toEqual({ left: 5, total: 5 });
    f = answer(f, 'yes');
    expect(stepsLeft(f)).toEqual({ left: 4, total: 5 });
    f = answer(answer(f, 'yes'), 'yes');
    expect(stepsLeft(f)).toEqual({ left: 2, total: 5 });
    f = again(safety(f, true), true);
    expect(stepsLeft(f)).toEqual({ left: 0, total: 5 });
  });
});
