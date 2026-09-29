/**
 * The catalog is the contract between the builder, the server and both renderers,
 * so its invariants are tested where no renderer is needed: every part has a free
 * item, a seed is one character for ever, nothing the renderers read can throw, a look
 * saved under an older catalog reads as it looked, and the rules that keep an outfit
 * drawable (`fitted`) hold whatever is picked in whatever order.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - drop the legacy branch of `clampLook` -> "reads a look saved before hair was its
 *     own choice" fails: the workwear head loses its hard hat, a bald man gets hair.
 *   - drop the face rule at the top of `fitted` -> "keeps Shaved and beards on the
 *     men's faces" fails.
 *   - drop the waist rule in `fitted` -> "keeps a top and its trousers on one figure"
 *     fails.
 */
import { describe, expect, it } from 'vitest';
import {
  BARE_ANKLES, CATALOG, EXTRA_PARTS, HARD_HAT, LOOK_PARTS, LOOK_SIZES, Look, NOT_OFFERED, SHAVED, SLOT_PARTS, STARTER,
  WARDROBE, WARDROBE_FIGURE, clampLook, currentItem, fitted, forFigure, itemAt, itemsOf, lockedIn, lookFor, lookKey,
  offeredFor, starterLookFor,
} from '@clone/shared';

const fig = (set: number) => WARDROBE_FIGURE[set] ?? 0;
const SETS = WARDROBE.map((_, i) => i);

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
    expect(Look.safeParse({ ...STARTER, hair: LOOK_SIZES.hair }).success).toBe(false);
    expect(Look.safeParse({ ...STARTER, skin: -1 }).success).toBe(false);
    expect(Look.safeParse({ ...STARTER, accessory: 1 }).success, 'the old one "extra" is not a part').toBe(false);
    expect(Look.safeParse({ ...STARTER, skin: 1.5 }).success).toBe(false);
    const c = clampLook({ top: 99, skin: -3, face: 'x', height: 2 });
    expect(Look.parse(c)).toEqual(c);
    expect(c.top).toBe(99 % LOOK_SIZES.top);
    expect(clampLook(null)).toEqual(STARTER);
  });

  it('dresses a row written before the wardrobe was split', () => {
    // `outfit` chose a whole body and `hair` chose a head; neither maps onto a slot
    // without inventing what somebody picked, so both are dropped and that person is
    // back in the starter set. What they BOUGHT is in another table and is not touched.
    const old = { skin: 5, body: 2, hair: 3, hairColor: 6, face: 1, outfit: 6, outfitColor: 9, accessory: 2 };
    const now = clampLook(old);
    expect(Look.parse(now)).toEqual(now);
    expect(now.skin, 'their skin is still theirs').toBe(5);
    expect(now.hat, 'and so is their cap').toBe(1);
    expect(now.top).toBe(STARTER.top);
    expect(now.head).toBe(STARTER.head);
    expect(now.hair, 'their hair is their head\'s own').toBe(STARTER.head);
    expect(now).not.toHaveProperty('outfit');
    expect(now).not.toHaveProperty('accessory');
  });

  it('reads a look saved before hair was its own choice as it looked', () => {
    const before = (over: Record<string, number>) =>
      clampLook({ figure: 0, skin: 3, body: 1, head: 0, hairColor: 0, beard: 0, top: 0, outfitColor: 2, legs: 0, feet: 0, accessory: 0, ...over });
    // Each head wore its own hair.
    for (const head of SETS) expect(before({ head, figure: fig(head) }).hair).toBe(head);
    // The workwear heads wore a hard hat, which is a hat now: it stays on...
    expect(before({ head: 4 }).hat).toBe(HARD_HAT);
    expect(before({ head: 3, figure: 1 }).hat).toBe(HARD_HAT);
    // ...unless they had put a cap on, which is what they chose to wear.
    expect(before({ head: 4, accessory: 2 }).hat).toBe(1);
    // Bald was head 10: the first men's face, shaved.
    const bald = before({ head: 10 });
    expect(bald.head).toBe(WARDROBE_FIGURE.indexOf(0));
    expect(bald.hair).toBe(SHAVED);
    // The one extra goes to where it is worn now.
    expect(before({ accessory: 1 })).toMatchObject({ glasses: 1, hat: 0, earrings: 0, neck: 0 });
    expect(before({ accessory: 3 })).toMatchObject({ earrings: 1, glasses: 0 });
    expect(before({ accessory: 4 })).toMatchObject({ neck: 1, glasses: 0 });
    // Everything new starts where everybody looked before it existed.
    expect(before({})).toMatchObject({ height: STARTER.height, eyes: 0, legsColor: 0, feetColor: 0, bag: 0 });
    // A look saved since keeps its hair exactly.
    const now = { ...STARTER, head: 4, hair: 7 };
    expect(clampLook(now)).toEqual(now);
  });

  it('keeps what was bought under its old name', () => {
    expect(currentItem('accessory:1')).toBe('glasses:1');
    expect(currentItem('accessory:2')).toBe('hat:1');
    expect(currentItem('accessory:3')).toBe('earrings:1');
    expect(currentItem('accessory:4')).toBe('neck:1');
    for (let h = 5; h < 10; h++) expect(currentItem(`head:${h}`)).toBe(`hair:${h}`);
    expect(currentItem('top:8')).toBe('top:8');
    // Everything anybody paid for is still something that costs, so a purchase is
    // never quietly turned into a thing everybody has.
    for (const old of ['accessory:1', 'accessory:2', 'accessory:3', 'accessory:4', 'head:5', 'head:6', 'head:7', 'head:8', 'head:9']) {
      const item = CATALOG.find((i) => i.id === currentItem(old));
      expect(item, `${old} maps to nothing`).toBeDefined();
      expect(item!.cost, `${old} maps to a free item`).toBeGreaterThan(0);
    }
  });

  it('offers a rail per figure, with both figures dressed for free', () => {
    for (const part of SLOT_PARTS) {
      for (const figure of [0, 1]) {
        const here = offeredFor(part, figure);
        expect(here.length, `${part} offers a ${figure ? 'woman' : 'man'} nothing`).toBeGreaterThan(2);
        for (const i of here) expect(fig(i), `${part} ${i} is on the wrong rail`).toBe(figure);
        for (const i of NOT_OFFERED[part] ?? []) expect(here, `${part} offers the copy ${i}`).not.toContain(i);
        const free = here.filter((i) => itemAt(part, i).cost === 0);
        expect(free.length, `a ${figure ? 'woman' : 'man'} has no free ${part}`).toBeGreaterThan(0);
      }
    }
    // Hair is anybody's, own figure's first. Shaved is offered on the men's faces only:
    // the founder's call, because a woman's head in this pack is a face with no skull
    // behind it, so a shaved one is invented rather than drawn.
    for (const figure of [0, 1]) {
      const hairs = offeredFor('hair', figure);
      expect(hairs.includes(SHAVED)).toBe(figure === 0);
      expect(hairs).not.toContain(9);
      expect(fig(hairs[0]!)).toBe(figure);
      expect(new Set(hairs).size).toBe(hairs.length);
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
    const back = forFigure(woman, 0);
    for (const part of SLOT_PARTS) expect(offeredFor(part, 0)).toContain(back[part]);
    // Anything already on the right rail is left exactly as it was.
    expect(forFigure(woman, 1)).toEqual(woman);
    // What they wear on top, their colours, build and height are theirs either way.
    const dressed = { ...man, hat: 2, glasses: 1, height: 4, outfitColor: 7 };
    expect(forFigure(dressed, 1)).toMatchObject({ hat: 2, glasses: 1, height: 4, outfitColor: 7 });
  });

  it('keeps Shaved and beards on the men\'s faces, whatever order things are picked in', () => {
    // A woman's face ends at the hairline with nothing behind it, and a beard is cut
    // from the men's jaw. A MAN may pick a woman's face too, so the rule is the face's.
    const shavedBeard = { ...STARTER, hair: SHAVED, beard: 4 };
    for (const face of SETS) {
      const out = fitted({ ...shavedBeard, head: face }, 'head');
      if (fig(face) === 0) {
        expect(out.hair, `face ${face} lost its shave`).toBe(SHAVED);
        expect(out.beard, `face ${face} lost its beard`).toBe(4);
      } else {
        expect(out.hair, `face ${face} is shaved`).not.toBe(SHAVED);
        expect(itemAt('hair', out.hair).cost, `face ${face} was given hair that costs`).toBe(0);
        expect(out.beard, `face ${face} has a beard`).toBe(0);
      }
    }
    expect(forFigure(shavedBeard, 1)).toMatchObject({ beard: 0 });
    expect(forFigure(shavedBeard, 1).hair).not.toBe(SHAVED);
    for (let seed = 1; seed <= 40; seed++) {
      for (const made of [lookFor(seed), starterLookFor(seed)]) {
        if (fig(made.head) !== 0) {
          expect(made.hair, `seed ${seed} made a shaved woman's face`).not.toBe(SHAVED);
          expect(made.beard, `seed ${seed} made a bearded woman's face`).toBe(0);
        }
      }
    }
  });

  it('keeps a top and its trousers on one figure, and bare legs over their own shoes', () => {
    // Measured, not guessed (render-looks.mts top-legs and legs-feet): every
    // cross-figure top and trousers left a gap or a shirt through the waistband, and
    // other-figure shoes under bare legs step at the ankle.
    for (const top of SETS) {
      for (const legs of SETS) {
        for (const feet of SETS) {
          for (const changed of ['top', 'legs', 'feet'] as const) {
            const out = fitted({ ...STARTER, top, legs, feet }, changed);
            expect(fig(out.top), `${top}/${legs}/${feet} ${changed}`).toBe(fig(out.legs));
            if (BARE_ANKLES.has(out.legs)) expect(fig(out.feet)).toBe(fig(out.legs));
            // What was just picked stays picked.
            expect(out[changed]).toBe({ top, legs, feet }[changed]);
          }
        }
      }
    }
  });

  it('puts one in four practice people in each extra, and nobody in all five', () => {
    let worn = 0, all = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const l = lookFor(seed);
      const n = EXTRA_PARTS.filter((p) => l[p] > 0).length;
      worn += n;
      if (n === EXTRA_PARTS.length) all++;
    }
    // Each extra is on one in four and then the "none" index can come up too, so the
    // mean is a little under 5 * 0.25 * (1 - 1/size).
    expect(worn / 400).toBeGreaterThan(0.6);
    expect(worn / 400).toBeLessThan(1.3);
    expect(all).toBeLessThan(4);
  });

  it('keys a look stably for memoisation', () => {
    expect(lookKey(STARTER)).toBe(lookKey({ ...STARTER }));
    for (const part of LOOK_PARTS) {
      const other = { ...STARTER, [part]: (STARTER[part] + 1) % LOOK_SIZES[part] };
      expect(lookKey(other), `${part} is not in the key`).not.toBe(lookKey(STARTER));
    }
  });
});
