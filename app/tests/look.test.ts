/**
 * The catalog is the contract between the builder, the server and both renderers,
 * so its invariants are tested where no renderer is needed: every part has a free
 * item, a seed is one character for ever, and nothing the renderers read can throw.
 */
import { describe, expect, it } from 'vitest';
import {
  BALD, CATALOG, LOOK_PARTS, LOOK_SIZES, Look, SLOT_PARTS, STARTER, WARDROBE_FIGURE, clampLook,
  forFigure, itemAt, itemsOf, lockedIn, lookFor, lookKey, offeredFor, starterLookFor,
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
    expect(Look.safeParse({ ...STARTER, top: LOOK_SIZES.top }).success).toBe(false);
    expect(Look.safeParse({ ...STARTER, skin: -1 }).success).toBe(false);
    expect(Look.safeParse({ ...STARTER, hat: 1 }).success).toBe(false);
    expect(Look.safeParse({ ...STARTER, skin: 1.5 }).success).toBe(false);
    const c = clampLook({ top: 99, skin: -3, face: 'x' });
    expect(Look.parse(c)).toEqual(c);
    expect(c.top).toBe(99 % LOOK_SIZES.top);
    expect(clampLook(null)).toEqual(STARTER);
  });

  it('dresses a row written before the wardrobe was split', () => {
    // The migration, such as it is. `outfit` chose a whole body and `hair` chose a
    // head; neither maps onto a slot without inventing what somebody picked, so both
    // are dropped and that person is back in the starter set. What they BOUGHT is in
    // another table and is not touched.
    const old = { skin: 5, body: 2, hair: 3, hairColor: 6, face: 1, outfit: 6, outfitColor: 9, accessory: 2 };
    const now = clampLook(old);
    expect(Look.parse(now)).toEqual(now);
    expect(now.skin, 'their skin is still theirs').toBe(5);
    expect(now.accessory, 'and so are their glasses').toBe(2);
    expect(now.top).toBe(STARTER.top);
    expect(now.head).toBe(STARTER.head);
    expect(now).not.toHaveProperty('outfit');
  });

  it('offers a rail per figure, with both figures dressed for free', () => {
    for (const part of SLOT_PARTS) {
      for (const figure of [0, 1]) {
        const here = offeredFor(part, figure);
        expect(here.length, `${part} offers a ${figure ? 'woman' : 'man'} nothing`).toBeGreaterThan(2);
        for (const i of here) {
          if (i === BALD) continue;
          expect(WARDROBE_FIGURE[i], `${part} ${i} is on the wrong rail`).toBe(figure);
        }
        // Bald is offered to the men only: the founder's call, and the reason is that
        // a woman's head in this pack is a face with no skull behind it, so a bald one
        // is invented rather than drawn.
        if (part === 'head') {
          expect(here.includes(BALD), `a ${figure ? 'woman' : 'man'} is offered the wrong bald rule`)
            .toBe(figure === 0);
        } else {
          expect(here, `${part} offers Bald`).not.toContain(BALD);
        }
        const free = here.filter((i) => CATALOG.find((c) => c.part === part && c.index === i)!.cost === 0);
        expect(free.length, `a ${figure ? 'woman' : 'man'} has no free ${part}`).toBeGreaterThan(0);
      }
    }
  });

  it('moves the clothes when somebody answers which figure they are', () => {
    const man = { ...STARTER, top: 8, legs: 8, feet: 8, head: 8 };   // the men's suit, head to toe
    const woman = forFigure(man, 1);
    expect(woman.figure).toBe(1);
    for (const part of SLOT_PARTS) {
      expect(offeredFor(part, 1), `${part} stayed on the men's rail`).toContain(woman[part]);
      expect(lockedIn(woman, new Set()).some((i) => i.part === part), `${part} costs points now`).toBe(false);
    }
    // Going back is not a round trip -- the suit was theirs, the starter is what a
    // figure gives you -- but it must land somewhere legal either way.
    const back = forFigure(woman, 0);
    for (const part of SLOT_PARTS) expect(offeredFor(part, 0)).toContain(back[part]);
    // Anything already on the right rail is left exactly as it was.
    expect(forFigure(woman, 1)).toEqual(woman);
  });

  it('takes a bald head off somebody who says she is a woman', () => {
    const bald = { ...STARTER, head: BALD };
    expect(Look.parse(bald)).toEqual(bald);
    const her = forFigure(bald, 1);
    expect(her.head, 'she is still bald').not.toBe(BALD);
    expect(offeredFor('head', 1), 'she can still pick it').toContain(her.head);
    expect(itemAt('head', her.head).cost, 'she was moved onto something she has to buy').toBe(0);
    // A man keeps it, and nobody is seeded with one who should not have it.
    expect(forFigure(bald, 0).head).toBe(BALD);
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      for (const made of [lookFor(seed), starterLookFor(seed)]) {
        if (made.figure !== 0) expect(made.head, 'a woman was seeded bald').not.toBe(BALD);
      }
    }
  });

  it('offers facial hair to the men and takes it off the women', () => {
    // It is cut out of the MEN'S face in the build, so it is theirs. A woman with a
    // beard is not a thing the renderer can draw, so the catalog does not allow it.
    const bearded = { ...STARTER, beard: 4 };
    expect(Look.parse(bearded)).toEqual(bearded);
    expect(forFigure(bearded, 1).beard, 'a woman kept the beard').toBe(0);
    expect(forFigure(bearded, 0).beard, 'a man lost his beard').toBe(4);
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const made of [lookFor(seed), starterLookFor(seed)]) {
        if (made.figure !== 0) expect(made.beard, 'a woman was seeded with a beard').toBe(0);
      }
    }
    expect(Look.safeParse({ ...STARTER, beard: LOOK_SIZES.beard }).success).toBe(false);
  });

  it('keys a look stably for memoisation', () => {
    expect(lookKey(STARTER)).toBe(lookKey({ ...STARTER }));
    expect(lookKey({ ...STARTER, top: 1 })).not.toBe(lookKey(STARTER));
    expect(lookKey({ ...STARTER, feet: 1 })).not.toBe(lookKey(STARTER));
  });
});
