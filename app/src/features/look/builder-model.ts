/**
 * What the builder shows, as data: its tabs, the rows in each, the choices in each row,
 * and what a pick changes. The screen (builder.tsx) only draws this.
 *
 * WHY IT WAS REDONE (the founder, 2026-09-29: "the UX looks confusing ... why do we
 * have an option called colour, how does the user know what it changes"). The old
 * builder was two rails of eleven round icons over the character, one of them "Colour"
 * -- which coloured the top, and said so nowhere. Now every colour is a row directly
 * under the thing it colours and says so in its title ("Top colour"), the rows are
 * grouped the way a person thinks about getting dressed (Body, Face, Hair, Top,
 * Bottoms, Shoes, Extras), and when a pick changes something else -- a woman's top
 * brings its own trousers (`fitted`) -- the builder says what changed and why.
 *
 * NO REACT NATIVE HERE, so tests/builder-model.test.ts can hold it: every part of a
 * look is in exactly one row, every row offers what is being worn, and the note
 * says what `fitted` did.
 */
import {
  EYE_HEX, HAIR_HEX, HAIR_ORDER, LOOK_LABELS, LOOK_PARTS, LOOK_SIZES, NOT_OFFERED, OUTFIT_HEX, SHAVED, SKIN_HEX,
  SKIN_ORDER, WARDROBE_FIGURE, fitted, forFigure, itemAt, offeredFor, type Look, type LookPart, type SlotPart,
} from '@clone/shared';
import type { Focus } from '../world/framing';

/** How a row shows its choices: pictures of the pieces, colour swatches, or words. */
export type RowKind = 'pictures' | 'swatches' | 'words';

export interface Row {
  part: LookPart;
  title: string;
  kind: RowKind;
  /** Where the camera goes when something in this row is picked. */
  focus: Focus;
}

export interface Tab {
  key: 'body' | 'face' | 'hair' | 'top' | 'bottoms' | 'shoes' | 'extras';
  label: string;
  rows: Row[];
}

/** Is this face one of the men's? Shaved and beards are theirs (shared/look.ts `fitted`). */
const mensFace = (look: Look) => (WARDROBE_FIGURE[look.head] ?? 0) === 0;

/** The tabs, for this look: the beard row is only there on a men's face. */
export function tabsFor(look: Look): Tab[] {
  return [
    { key: 'body', label: 'Body', rows: [
      { part: 'figure', title: 'You are', kind: 'words', focus: 'body' },
      { part: 'skin', title: 'Skin tone', kind: 'swatches', focus: 'bust' },
      { part: 'body', title: 'Build', kind: 'words', focus: 'body' },
      { part: 'height', title: 'Height', kind: 'words', focus: 'body' },
    ] },
    { key: 'face', label: 'Face', rows: [
      { part: 'head', title: 'Face', kind: 'pictures', focus: 'head' },
      { part: 'eyes', title: 'Eye colour', kind: 'swatches', focus: 'head' },
      ...(mensFace(look) ? [{ part: 'beard', title: 'Beard', kind: 'pictures', focus: 'head' } as Row] : []),
    ] },
    { key: 'hair', label: 'Hair', rows: [
      { part: 'hair', title: 'Hairstyle', kind: 'pictures', focus: 'head' },
      { part: 'hairColor', title: 'Hair colour', kind: 'swatches', focus: 'head' },
    ] },
    { key: 'top', label: 'Top', rows: [
      { part: 'top', title: 'Top', kind: 'pictures', focus: 'top' },
      { part: 'outfitColor', title: 'Top colour', kind: 'swatches', focus: 'top' },
    ] },
    { key: 'bottoms', label: 'Bottoms', rows: [
      { part: 'legs', title: 'Bottoms', kind: 'pictures', focus: 'legs' },
      { part: 'legsColor', title: 'Bottoms colour', kind: 'swatches', focus: 'legs' },
    ] },
    { key: 'shoes', label: 'Shoes', rows: [
      { part: 'feet', title: 'Shoes', kind: 'pictures', focus: 'feet' },
      { part: 'feetColor', title: 'Shoe colour', kind: 'swatches', focus: 'feet' },
    ] },
    { key: 'extras', label: 'Extras', rows: [
      { part: 'hat', title: 'Hat', kind: 'pictures', focus: 'head' },
      { part: 'glasses', title: 'Glasses', kind: 'pictures', focus: 'head' },
      { part: 'earrings', title: 'Earrings', kind: 'pictures', focus: 'head' },
      { part: 'neck', title: 'Round the neck', kind: 'pictures', focus: 'bust' },
      { part: 'bag', title: 'Bag', kind: 'pictures', focus: 'body' },
    ] },
  ];
}

/**
 * The choices a row offers, in the order shown.
 *
 * Clothes and faces: the person's own figure's first, then the other figure's -- every
 * piece fits every body, so nothing is off limits, it is just further along. Hair: the
 * face's own figure's first; Shaved only on the men's faces. Colours of skin and hair
 * light to dark. Never the pack's duplicate pieces (NOT_OFFERED) -- unless it is what
 * they are wearing, because nothing a person has on may vanish from under them.
 */
export function choicesFor(part: LookPart, look: Look): number[] {
  const all = Array.from({ length: LOOK_SIZES[part] }, (_, i) => i);
  let out: number[];
  switch (part) {
    case 'skin': out = [...SKIN_ORDER]; break;
    case 'hairColor': out = [...HAIR_ORDER]; break;
    case 'hair': out = offeredFor('hair', WARDROBE_FIGURE[look.head] ?? 0); break;
    case 'head': case 'top': case 'legs': case 'feet': {
      const slot = part as SlotPart;
      out = [...offeredFor(slot, look.figure), ...offeredFor(slot, 1 - look.figure)];
      break;
    }
    default: out = all;
  }
  const hidden = (NOT_OFFERED as Partial<Record<LookPart, readonly number[]>>)[part] ?? [];
  out = out.filter((i) => !hidden.includes(i));
  if (!out.includes(look[part])) out.push(look[part]);
  return out;
}

/** Where the other figure's pieces start in a row, for a divider; null if nowhere. */
export function otherFigureFrom(part: LookPart, look: Look): number | null {
  if (part !== 'head' && part !== 'top' && part !== 'legs' && part !== 'feet') return null;
  const own = offeredFor(part, look.figure).filter((i) => !(NOT_OFFERED[part] ?? []).includes(i)).length;
  return own;
}

/** A swatch's colour, or null for "As made" (the trousers' or shoes' own colour). */
export function swatchOf(part: LookPart, index: number): string | null {
  switch (part) {
    case 'skin': return SKIN_HEX[index] ?? null;
    case 'hairColor': return HAIR_HEX[index] ?? null;
    case 'eyes': return EYE_HEX[index] ?? null;
    case 'outfitColor': return OUTFIT_HEX[index] ?? null;
    case 'legsColor': case 'feetColor': return index === 0 ? null : OUTFIT_HEX[index - 1] ?? null;
    default: return null;
  }
}

/**
 * A choice's name, for its label and for the screen reader. A face is numbered in the
 * order its row shows it: the catalog names faces after the outfit they came with,
 * and a face called "Hoodie" says nothing about a face.
 */
export function labelOf(part: LookPart, index: number, look?: Look): string {
  if (part === 'head' && look) return `Face ${choicesFor('head', look).indexOf(index) + 1}`;
  return LOOK_LABELS[part][index] ?? itemAt(part, index).label;
}

/** What each part is called when the builder says it changed. */
const NAMED: Partial<Record<LookPart, string>> = {
  head: 'face', hair: 'hairstyle', beard: 'beard', top: 'top', legs: 'bottoms', feet: 'shoes',
};

/**
 * Pick something. Returns the new look and, when the pick changed anything else, a
 * sentence saying what and why -- or the change reads as the builder misbehaving.
 */
export function pick(look: Look, part: LookPart, index: number): { look: Look; note: string | null } {
  let next: Look;
  if (part === 'figure') next = forFigure(look, index);
  else if (part === 'head' || part === 'top' || part === 'legs' || part === 'feet') next = fitted({ ...look, [part]: index }, part);
  else next = { ...look, [part]: index };
  const moved = LOOK_PARTS.filter((k) => k !== part && next[k] !== look[k]);
  if (!moved.length) return { look: next, note: null };
  if (part === 'figure') return { look: next, note: 'Your clothes changed to fit.' };
  const names = moved.map((k) => NAMED[k]).filter((n): n is string => !!n);
  if (!names.length) return { look: next, note: null };
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const why = part === 'head' && moved.some((k) => k === 'hair' || k === 'beard')
    ? (look.hair === SHAVED ? ' A shaved head and a beard go on the men\'s faces.' : ' A beard goes on the men\'s faces.')
    : '';
  return { look: next, note: `Your ${list} changed to fit.${why}` };
}
