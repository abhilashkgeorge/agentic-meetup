/**
 * The one-word shapes the two flat renderers draw from.
 *
 * Neither the avatar in the lists nor the capsule fallback can show the real meshes,
 * so both read `silhouette.ts` instead. What this guards is that the table covers the
 * whole catalog -- a set added to the wardrobe with no entry here would fall back to
 * 'short' and 'plain' and quietly dress everybody the same -- and that the shapes come
 * off the RIGHT SLOT now that they are different answers: a collar off the top, a
 * skirt off the legs, hair off the head.
 *
 * Negative control, run by hand and recorded in the commit: read `look.top` in
 * `hairOf` -> "each shape comes off its own slot" fails, the hair follows the shirt.
 */
import { describe, expect, it } from 'vitest';
import { BALD, LOOK_LABELS, LOOK_SIZES, STARTER, WARDROBE, type Look } from '@clone/shared';
import { beardOf, hairOf, skirtOf, topOf } from '../src/features/look/silhouette';

const look = (over: Partial<Look> = {}): Look => ({ ...STARTER, ...over });

describe('the flat silhouette', () => {
  it('has a shape for every set in the wardrobe, and for bald', () => {
    const hairs = new Set<string>();
    const tops = new Set<string>();
    for (let i = 0; i < WARDROBE.length; i++) {
      const h = hairOf(look({ head: i }));
      const t = topOf(look({ top: i }));
      expect(h, `${WARDROBE[i]} has no hair shape`).toBeTruthy();
      expect(h, 'only Bald is bald').not.toBe('bald');
      expect(['plain', 'collar', 'straps', 'open'], `${WARDROBE[i]} has a strange top`).toContain(t);
      hairs.add(h); tops.add(t);
    }
    expect(hairOf(look({ head: BALD }))).toBe('bald');
    // If everything came out the same the table would be useless and the test blind.
    expect(hairs.size, 'every head has the same hair').toBeGreaterThan(3);
    expect(tops.size, 'every top looks the same').toBeGreaterThan(2);
  });

  it('takes each shape off its own slot', () => {
    // A person in the punk jacket with the trouser suit's head and the formal skirt is
    // three different answers, which is exactly what the split is for.
    const mixed = look({ head: 9, top: 7, legs: 6 });
    expect(hairOf(mixed)).toBe('bun');        // from the head
    expect(topOf(mixed)).toBe('open');        // from the top
    expect(skirtOf(mixed)).toBe(true);        // from the legs
    // ...and changing one slot moves nothing else.
    expect(hairOf(look({ ...mixed, top: 0, legs: 0 }))).toBe('bun');
    expect(topOf(look({ ...mixed, head: 0, legs: 0 }))).toBe('open');
    expect(skirtOf(look({ ...mixed, head: 0, top: 0 }))).toBe(true);
  });

  it('has a shape for every facial hair in the catalog', () => {
    const seen = new Set<string>();
    for (let i = 0; i < LOOK_SIZES.beard; i++) {
      const k = beardOf(look({ beard: i }));
      expect(k, `${LOOK_LABELS.beard[i]} has no shape`).toBeTruthy();
      seen.add(k);
    }
    expect(beardOf(look({ beard: 0 })), 'Clean is not clean').toBe('none');
    expect(seen.size, 'every beard looks the same').toBe(LOOK_SIZES.beard);
  });

  it('never throws on an index it has not heard of', () => {
    for (let i = 0; i < LOOK_SIZES.head + 4; i++) {
      expect(() => hairOf(look({ head: i }))).not.toThrow();
      expect(() => beardOf(look({ beard: i }))).not.toThrow();
      expect(() => topOf(look({ top: i }))).not.toThrow();
      expect(() => skirtOf(look({ legs: i }))).not.toThrow();
    }
  });

  it('puts a skirt on exactly one set of legs', () => {
    const skirts = Array.from({ length: WARDROBE.length }, (_, i) => i).filter((i) => skirtOf(look({ legs: i })));
    expect(skirts).toHaveLength(1);
    expect(WARDROBE[skirts[0]!]).toBe('Formal');
  });
});
