/**
 * What a pair counts as when the scorers are measured.
 *
 * TWO WAYS THE REPORT WAS WRONG, both found reading scripts/compare-scorers.ts against
 * orchestrator.ts and migration 0058:
 *   1. A pair was labelled only once BOTH humans had answered -- but a first-mover no
 *      lapses the pair and the second person is never asked, so every one of those
 *      negatives fell out of the measurement.
 *   2. "Would you see them again" was read through checkin_mutual_again, which counts
 *      no answer as no, so silence and a bad date looked the same.
 *
 * Negative controls, run by hand:
 *   - pairOutcome needing both answers before a no   -> "a single no decides it" fails
 *   - seeAgainOutcome treating silence as not_again  -> "no answer is its own" fails
 */
import { describe, expect, it } from 'vitest';
import { pairOutcome, seeAgainOutcome } from '../src/matching/evaluate.js';

describe('pairOutcome', () => {
  it('a single no decides it, from either side', () => {
    expect(pairOutcome(false, null)).toBe('no');
    expect(pairOutcome(null, false)).toBe('no');
    expect(pairOutcome(true, false)).toBe('no');
  });
  it('a yes needs both', () => {
    expect(pairOutcome(true, true)).toBe('yes');
    expect(pairOutcome(true, null)).toBeNull();
    expect(pairOutcome(null, null)).toBeNull();
  });
});

describe('seeAgainOutcome', () => {
  const c = (met: boolean, seeAgain: boolean | null) => ({ met, seeAgain });
  it('is again only when both answered and both would', () => {
    expect(seeAgainOutcome([c(true, true), c(true, true)])).toBe('again');
  });
  it('one no settles it, answered or not by the other', () => {
    expect(seeAgainOutcome([c(true, false)])).toBe('not_again');
    expect(seeAgainOutcome([c(true, true), c(true, false)])).toBe('not_again');
  });
  it('no answer is its own bucket, never a no', () => {
    expect(seeAgainOutcome([])).toBe('no_response');
    expect(seeAgainOutcome([c(true, true)])).toBe('no_response');
  });
  it('not sure, or did not meet, is neither yes nor no', () => {
    expect(seeAgainOutcome([c(true, true), c(true, null)])).toBe('unsure');
    expect(seeAgainOutcome([c(false, null), c(false, null)])).toBe('unsure');
  });
});
