/**
 * The top of the You tab says where you live as people say it: "Indiranagar, Bangalore".
 *
 * WHAT WAS WRONG (the two-phone test, 2026-10-02): it said "Bangalore" though the part of
 * town was saved -- the line was built from the city alone.
 *
 * WHAT IS GUARDED: placeLine puts the part of town before the city when the map knows it
 * (Bangalore by either name), never a part under a city the map does not cover, and the
 * city alone otherwise; the You tab's title uses it (SOURCE SHAPE: the screen is React
 * Native and these tests run without it).
 *
 * Negative controls, run by hand and recorded in the commit: the title back to the city
 * alone -> "the You tab uses it" fails; placeLine returning the city -> "part and city" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { placeLine } from '../src/features/profile/fields';

describe('where you live, at the top of the You tab', () => {
  it('part and city, when the part of town is known', () => {
    expect(placeLine('Bangalore', 'indiranagar')).toBe('Indiranagar, Bangalore');
    expect(placeLine('bengaluru', 'mg-road')).toBe('MG Road, bengaluru');
    expect(placeLine(null, 'indiranagar')).toBe('Indiranagar');
  });

  it('the city alone when the part is not known, or is not in that city', () => {
    expect(placeLine('Bangalore', null)).toBe('Bangalore');
    expect(placeLine('Bangalore', 'no-such-area')).toBe('Bangalore');
    // Moved to Mumbai since: an old Bangalore part of town is not put under it.
    expect(placeLine('Mumbai', 'indiranagar')).toBe('Mumbai');
    expect(placeLine(null, null)).toBeUndefined();
  });

  it('the You tab uses it', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'profile', 'profile-screen.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).toContain("subtitle={[placeLine(city, valueOf(k, 'area')), work].filter(Boolean).join(' · ') || undefined}");
  });
});
