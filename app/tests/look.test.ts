/**
 * The catalog is the contract between the builder, the server and both renderers,
 * so its invariants are tested where no renderer is needed: every part has a free
 * item, a seed is one character for ever, and nothing the renderers read can throw.
 */
import { describe, expect, it } from 'vitest';
import {
  CATALOG, LOOK_PARTS, LOOK_SIZES, Look, STARTER, clampLook, itemsOf, lockedIn, lookFor, lookKey, starterLookFor,
} from '@clone/shared';

describe('the catalog', () => {
  it('has unique ids, one label per index, and a free item for every part', () => {
    const ids = CATALOG.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const part of LOOK_PARTS) {
      const items = CATALOG.filter((i) => i.part === part);
      expect(items).toHaveLength(LOOK_SIZES[part]);
      expect(items.some((i) => i.cost === 0), `${part} has a free item`).toBe(true);
    }
  });

  it('starts everybody on free items', () => {
    expect(Look.parse(STARTER)).toEqual(STARTER);
    expect(lockedIn(STARTER, new Set())).toEqual([]);
    expect(itemsOf(STARTER).every((i) => i.cost === 0)).toBe(true);
  });

  it('gives one seed one character, inside the catalog, for ever', () => {
    const a = lookFor(7); const b = lookFor(7);
    expect(a).toEqual(b);
    expect(Look.parse(a)).toEqual(a);
    expect(lookFor(8)).not.toEqual(a);
    // The free variant wears nothing that costs.
    const s = starterLookFor(7);
    expect(lockedIn(s, new Set())).toEqual([]);
    expect(starterLookFor(7)).toEqual(s);
  });

  it('refuses what is not in the catalog, and clamps what the renderers read', () => {
    expect(Look.safeParse({ ...STARTER, hair: 8 }).success).toBe(false);
    expect(Look.safeParse({ ...STARTER, skin: -1 }).success).toBe(false);
    expect(Look.safeParse({ ...STARTER, hat: 1 }).success).toBe(false);
    expect(Look.safeParse({ ...STARTER, skin: 1.5 }).success).toBe(false);
    const c = clampLook({ hair: 99, skin: -3, face: 'x' });
    expect(Look.parse(c)).toEqual(c);
    expect(c.hair).toBe(99 % LOOK_SIZES.hair);
    expect(clampLook(null)).toEqual(STARTER);
  });

  it('keys a look stably for memoisation', () => {
    expect(lookKey(STARTER)).toBe(lookKey({ ...STARTER }));
    expect(lookKey({ ...STARTER, hair: 1 })).not.toBe(lookKey(STARTER));
  });
});
