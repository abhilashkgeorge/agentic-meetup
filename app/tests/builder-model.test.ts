/**
 * The builder's rows and what a pick does, with no screen in the room.
 *
 * WHAT THIS GUARDS (the founder, 2026-09-29: "why do we have an option called colour,
 * how does the user know what it changes"):
 *   - every part of a look is in exactly one row, so nothing is unreachable and
 *     nothing is offered twice;
 *   - every colour row sits right after the thing it colours and names it;
 *   - every row offers what is being worn -- nothing a person has on vanishes;
 *   - the pack's duplicate pieces are not offered, and Shaved and beards only on
 *     the men's faces;
 *   - a pick that changes something else says so.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - drop the "still worn" line from `choicesFor` -> "offers what is being worn" fails
 *     for the trouser suit's shoes.
 *   - return no note from `pick` -> "says what else a pick changed" fails.
 */
import { describe, expect, it } from 'vitest';
import {
  LOOK_PARTS, NOT_OFFERED, SHAVED, STARTER, WARDROBE_FIGURE, lookFor, type Look, type LookPart,
} from '@clone/shared';
import { choicesFor, otherFigureFrom, pick, swatchOf, tabsFor } from '../src/features/look/builder-model';

const look = (over: Partial<Look> = {}): Look => ({ ...STARTER, ...over });

describe('the builder', () => {
  it('puts every part of a look in exactly one row', () => {
    const rows = tabsFor(look()).flatMap((t) => t.rows.map((r) => r.part));
    expect([...rows].sort()).toEqual([...LOOK_PARTS].sort());
    expect(new Set(rows).size).toBe(rows.length);
  });

  it('puts each colour right after what it colours, and names it', () => {
    const COLOURS: Partial<Record<LookPart, LookPart>> = {
      outfitColor: 'top', legsColor: 'legs', feetColor: 'feet', hairColor: 'hair',
    };
    for (const tab of tabsFor(look())) {
      tab.rows.forEach((row, i) => {
        const of = COLOURS[row.part];
        if (!of) return;
        expect(tab.rows[i - 1]?.part, `${row.title} is not under what it colours`).toBe(of);
        expect(row.title.toLowerCase(), `${row.title} does not say it is a colour`).toContain('colour');
        expect(row.kind).toBe('swatches');
      });
      // A row titled only "Colour" is the thing this exists to stop.
      for (const row of tab.rows) expect(row.title.toLowerCase()).not.toBe('colour');
    }
  });

  it('shows the beard row on the men\'s faces only', () => {
    for (let head = 0; head < 10; head++) {
      const rows = tabsFor(look({ head })).flatMap((t) => t.rows.map((r) => r.part));
      expect(rows.includes('beard'), `face ${head}`).toBe(WARDROBE_FIGURE[head] === 0);
    }
  });

  it('offers what is being worn, and never the pack\'s copies otherwise', () => {
    // Worn before the copies were hidden: the trouser suit's shoes and Long (straight).
    const wearing = look({ feet: 9, hair: 9, figure: 1, head: 1 });
    expect(choicesFor('feet', wearing)).toContain(9);
    expect(choicesFor('hair', wearing)).toContain(9);
    const other = look({ figure: 1, head: 1 });
    for (const [part, copies] of Object.entries(NOT_OFFERED) as [LookPart, number[]][]) {
      for (const i of copies) expect(choicesFor(part, other), `${part} ${i}`).not.toContain(i);
    }
    // Over a crowd of looks: every row always has the current choice, once.
    for (let seed = 1; seed <= 200; seed++) {
      const l = lookFor(seed);
      for (const part of LOOK_PARTS) {
        const c = choicesFor(part, l);
        expect(c, `${part} lost what seed ${seed} wears`).toContain(l[part]);
        expect(new Set(c).size, `${part} offers something twice`).toBe(c.length);
      }
    }
  });

  it('offers your own figure\'s clothes first, then the rest past a divider', () => {
    for (const figure of [0, 1]) {
      for (const part of ['head', 'top', 'legs', 'feet'] as const) {
        const l = look({ figure, head: figure });
        const c = choicesFor(part, l);
        const split = otherFigureFrom(part, l)!;
        expect(c.slice(0, split).every((i) => WARDROBE_FIGURE[i] === figure), `${part} for ${figure}`).toBe(true);
        expect(c.slice(split).every((i) => WARDROBE_FIGURE[i] !== figure), `${part} for ${figure}`).toBe(true);
      }
    }
    expect(otherFigureFrom('skin', look())).toBeNull();
  });

  it('offers Shaved on the men\'s faces only', () => {
    for (let head = 0; head < 10; head++) {
      expect(choicesFor('hair', look({ head })).includes(SHAVED), `face ${head}`).toBe(WARDROBE_FIGURE[head] === 0);
    }
  });

  it('gives trousers and shoes an "As made" before their colours', () => {
    expect(swatchOf('legsColor', 0)).toBeNull();
    expect(swatchOf('feetColor', 0)).toBeNull();
    expect(swatchOf('legsColor', 1)).toMatch(/^#/);
    expect(swatchOf('outfitColor', 0)).toMatch(/^#/);
  });

  it('says what else a pick changed, and nothing when it changed nothing else', () => {
    // A woman's top on a man's trousers: the trousers come with it.
    const a = pick(look(), 'top', 1);
    expect(a.look.legs).not.toBe(STARTER.legs);
    expect(a.note).toMatch(/bottoms changed to fit/i);
    // A woman's face on a shaved, bearded man: hair on, beard off, and why.
    const b = pick(look({ hair: SHAVED, beard: 2 }), 'head', 1);
    expect(b.look.hair).not.toBe(SHAVED);
    expect(b.look.beard).toBe(0);
    expect(b.note).toMatch(/hairstyle and beard changed/i);
    expect(b.note).toMatch(/men's faces/);
    // Which figure you are moves the clothes.
    expect(pick(look(), 'figure', 1).note).toMatch(/clothes changed/i);
    // A colour changes a colour.
    expect(pick(look(), 'outfitColor', 5)).toEqual({ look: look({ outfitColor: 5 }), note: null });
    expect(pick(look(), 'hat', 2).note).toBeNull();
  });
});
