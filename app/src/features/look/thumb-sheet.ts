/**
 * Where each choice's picture is on the sheet.
 *
 * Split out of `piece-thumb.tsx` so it can be tested: that file `require`s a PNG,
 * which Metro understands and a test runner does not. This is the arithmetic, and it
 * reads nothing but the manifest `scripts/build-thumbs.mts` writes.
 */
import manifest from '../../../assets/characters/people.json';
import { EXTRA_PARTS, SHAVED, WARDROBE_FIGURE, type ExtraPart, type SlotPart } from '@clone/shared';
import { LOOKS } from '../world/character';

const asset = manifest as {
  thumbs: { tile: number; cols: number; rows: number; index: Record<string, number> };
  beards?: readonly string[];
};
const thumbs = asset.thumbs;
const beards = asset.beards ?? [];

export const SHEET_COLS = thumbs.cols;
export const SHEET_ROWS = thumbs.rows;

/** Every part that has pictures: the four wardrobe slots, hair, beards and what is worn on top. */
export type PicturedPart = SlotPart | 'hair' | 'beard' | ExtraPart;
export const PICTURED: readonly PicturedPart[] = ['head', 'hair', 'beard', 'top', 'legs', 'feet', ...EXTRA_PARTS];
export const isPictured = (part: string): part is PicturedPart => (PICTURED as readonly string[]).includes(part);

/** The first men's face: what "Shaved" and "Clean" are pictured on. */
const MAN = LOOKS[WARDROBE_FIGURE.indexOf(0)]!;

/**
 * Where this choice's picture sits in the sheet, or null if there is none -- "None"
 * of anything worn on top is said in words, not drawn.
 */
export function tileOf(part: PicturedPart, index: number): { col: number; row: number } | null {
  let key: string;
  switch (part) {
    case 'head': key = `${LOOKS[index] ?? ''}:face`; break;
    // Shaved is a face with nothing on it.
    case 'hair': key = index === SHAVED ? `${MAN}:face` : `${LOOKS[index] ?? ''}:hair`; break;
    // "Clean" is that same face: a blank circle would say nothing.
    case 'beard': key = index === 0 ? `${MAN}:face` : `beard:${beards[index - 1] ?? ''}`; break;
    case 'top': case 'legs': case 'feet': key = `${LOOKS[index] ?? ''}:${part}`; break;
    default: key = `${part}:${index}`;
  }
  const at = thumbs.index[key];
  if (at === undefined) return null;
  return { col: at % thumbs.cols, row: Math.floor(at / thumbs.cols) };
}
