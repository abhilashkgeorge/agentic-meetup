/**
 * Where each piece's picture is on the sheet.
 *
 * Split out of `piece-thumb.tsx` so it can be tested: that file `require`s a PNG,
 * which Metro understands and a test runner does not. This is the arithmetic, and it
 * reads nothing but the manifest the build script writes.
 */
import manifest from '../../../assets/characters/people.json';
import { BALD, type SlotPart } from '@clone/shared';
import { LOOKS, baldBase } from '../world/character';

const asset = manifest as {
  thumbs: { tile: number; cols: number; rows: number; index: Record<string, number> };
  beards?: readonly string[];
};
const thumbs = asset.thumbs;
const beards = asset.beards ?? [];

export const SHEET_COLS = thumbs.cols;
export const SHEET_ROWS = thumbs.rows;

/**
 * Where this piece sits in the sheet, or null if the build never drew it.
 *
 * `figure` matters for one piece only: Bald has no set of its own, so it borrows a
 * face, and which face depends on whether the person is a man or a woman.
 */
export function tileOf(slot: SlotPart | 'beard', set: number, figure = 0): { col: number; row: number } | null {
  // A beard is drawn on a face, and "Clean" is that same face with nothing on it, so
  // the first option borrows the bald tile rather than being a blank circle.
  const key = slot === 'beard'
    ? (set === 0 ? `${LOOKS[baldBase(0)]}:bald` : `beard:${beards[set - 1] ?? ''}`)
    : slot === 'head' && set === BALD
      ? `${LOOKS[baldBase(figure)]}:bald`
      : `${LOOKS[set] ?? ''}:${slot}`;
  const at = thumbs.index[key];
  if (at === undefined) return null;
  return { col: at % thumbs.cols, row: Math.floor(at / thumbs.cols) };
}
