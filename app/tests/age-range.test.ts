/**
 * The ages you would meet: pre-filled from your own age, five either side, 18..99.
 *
 * WHAT WAS WRONG. `age_range_sought` is a fact the match profile reads into age_min /
 * age_max, and the candidate query tests it both ways. Nothing in the app wrote it for
 * a real person, so the age filter ran one way only. The essentials wizard now asks it,
 * pre-filled and editable -- and asks it whenever no range is held, because it gates
 * nothing and so never appears on the server's list of what is missing.
 *
 * Negative controls, run 2026-09-23: take the clamp out of ageRangeDefault -> the
 * 18-year-old, 20-year-old and 97-year-old cases fail. Make essentialSteps filter on
 * `need` alone, as the wizard used to -> "asks the range when none is held" fails.
 * Put the wizard's old `ESSENTIAL_FIELDS.filter((f) => need.includes(f.key))` back in
 * essentials-screen.tsx -> the wiring check fails.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGE_CEIL, AGE_FLOOR, ageRangeDefault, parseAgeRange, rangeFromText,
} from '../src/features/profile/age-range';
import { ESSENTIAL_FIELDS, essentialSteps } from '../src/features/profile/fields';

const NOW = new Date('2026-09-23T12:00:00Z');
const bornAt = (age: number) => NOW.getUTCFullYear() - age;

describe('ageRangeDefault', () => {
  it('is own age plus and minus five', () => {
    expect(ageRangeDefault(bornAt(32), NOW)).toEqual({ min: 27, max: 37 });
    expect(ageRangeDefault(1994, NOW)).toEqual({ min: 27, max: 37 });
  });

  it('never goes below 18', () => {
    expect(ageRangeDefault(bornAt(18), NOW)).toEqual({ min: 18, max: 23 });
    expect(ageRangeDefault(bornAt(20), NOW)).toEqual({ min: 18, max: 25 });
    expect(ageRangeDefault(bornAt(23), NOW)).toEqual({ min: 18, max: 28 });
  });

  it('never goes above 99', () => {
    expect(ageRangeDefault(bornAt(97), NOW)).toEqual({ min: 92, max: 99 });
    expect(ageRangeDefault(bornAt(99), NOW)).toEqual({ min: 94, max: 99 });
  });

  it('stays inside the bounds for every adult age', () => {
    for (let age = 18; age <= 110; age++) {
      const r = ageRangeDefault(bornAt(age), NOW)!;
      expect(r.min, `age ${age}`).toBeGreaterThanOrEqual(AGE_FLOOR);
      expect(r.max, `age ${age}`).toBeLessThanOrEqual(AGE_CEIL);
      expect(r.min, `age ${age}`).toBeLessThanOrEqual(r.max);
    }
    expect([AGE_FLOOR, AGE_CEIL]).toEqual([18, 99]);
  });

  it('guesses nothing without a birth year', () => {
    expect(ageRangeDefault(null, NOW)).toBeNull();
    expect(ageRangeDefault(undefined, NOW)).toBeNull();
    expect(ageRangeDefault(Number.NaN, NOW)).toBeNull();
  });
});

describe('parseAgeRange', () => {
  it('accepts a whole-number range inside 18..99', () => {
    expect(parseAgeRange('27', '37')).toEqual({ min: 27, max: 37 });
    expect(parseAgeRange('18', '99')).toEqual({ min: 18, max: 99 });
    expect(parseAgeRange('30', '30')).toEqual({ min: 30, max: 30 });
  });

  it('refuses a half-typed, reversed or out-of-bounds range', () => {
    expect(parseAgeRange('2', '35')).toBeNull();
    expect(parseAgeRange('40', '30')).toBeNull();
    expect(parseAgeRange('17', '30')).toBeNull();
    expect(parseAgeRange('30', '100')).toBeNull();
    expect(parseAgeRange('', '30')).toBeNull();
    expect(parseAgeRange('3o', '40')).toBeNull();
  });
});

describe('rangeFromText', () => {
  it('reads a stored range whatever words the server wrapped it in', () => {
    expect(rangeFromText('26-36')).toEqual({ min: 26, max: 36 });
    expect(rangeFromText('26 to 36')).toEqual({ min: 26, max: 36 });
    expect(rangeFromText('{"min":26,"max":36}')).toEqual({ min: 26, max: 36 });
    expect(rangeFromText(null)).toBeNull();
    expect(rangeFromText('[object Object]')).toBeNull();
  });
});

describe('the essentials wizard asks the range', () => {
  const keys = (need: string[], has: boolean) => essentialSteps(need, has).map((f) => f.key);

  it('asks the range when none is held, even with nothing else missing', () => {
    // An existing user in the pool: the server's `need` is empty.
    expect(keys([], false)).toEqual(['age_range_sought']);
  });

  it('does not ask it again once a range is held', () => {
    expect(keys([], true)).toEqual([]);
    expect(keys(['birth_date', 'lives_in'], true)).toEqual(['birth_date', 'lives_in']);
  });

  it('asks it after the birth year, so the pre-fill has an age to start from', () => {
    expect(keys(['birth_date', 'lives_in', 'max_distance_km'], false))
      .toEqual(['birth_date', 'age_range_sought', 'lives_in', 'max_distance_km']);
    const order = ESSENTIAL_FIELDS.map((f) => f.key);
    expect(order.indexOf('birth_date')).toBeLessThan(order.indexOf('age_range_sought'));
  });

  it('titles the step "Who would you like to meet?", as a range', () => {
    const f = ESSENTIAL_FIELDS.find((x) => x.key === 'age_range_sought')!;
    expect(f.title).toBe('Who would you like to meet?');
    expect(f.kind).toBe('range');
  });
});

/** The code with its comments removed. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('the essentials screen uses all of that', () => {
  // A screen cannot be rendered under vitest, so the wiring is read from the source,
  // comments stripped: a helper nobody calls guards nothing.
  const src = stripComments(readFileSync(
    join(import.meta.dirname, '..', 'src', 'features', 'onboarding', 'essentials-screen.tsx'), 'utf8',
  ));

  it('picks its steps with essentialSteps, from whether a range is already held', () => {
    expect(src).toMatch(/essentialSteps\(need, facts\.some\(\(f\) => f\.predicate === 'age_range_sought'\)\)/);
    expect(src).not.toMatch(/ESSENTIAL_FIELDS\.filter\(\(f\) => need\.includes\(f\.key\)\)/);
  });

  it('pre-fills from ageRangeDefault and posts the parsed {min, max}', () => {
    expect(src).toMatch(/ageRangeDefault\(/);
    expect(src).toMatch(/parseAgeRange\(raw\.min, raw\.max\)/);
    expect(src).toMatch(/skipped \? null : \(range \?\? raw \?\? null\)/);
  });
});
