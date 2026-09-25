/**
 * The picture of every piece, checked as a picture.
 *
 * `scripts/build-thumbs.mjs` rasterises forty-one tiles by hand -- there is no GL in
 * Node -- and the first run of it wrote a perfectly valid PNG of forty-one EMPTY
 * SQUARES, because the z-buffer started at +Infinity and rejected every fragment. It
 * was a 3 KB file instead of 100 KB and nothing threw. So this does not check that the
 * sheet exists; it decodes it and checks that something was actually drawn in every
 * tile, and that what was drawn is where the manifest says it is.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - fill the z-buffer with +Infinity again -> "draws something in every tile" fails,
 *     all 41 tiles come back empty.
 *   - drop the bald tile -> "has a tile for every piece a person can wear" fails.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { BALD, LOOK_SIZES, SLOT_PARTS, WARDROBE } from '@clone/shared';
import { LOOKS, baldBase } from '../src/features/world/character';
import { tileOf } from '../src/features/look/thumb-sheet';

const ASSETS = join(import.meta.dirname, '..', 'assets', 'characters');
const manifest = JSON.parse(readFileSync(join(ASSETS, 'people.json'), 'utf8')) as {
  thumbs: { tile: number; cols: number; rows: number; index: Record<string, number> };
  beards: string[];
};
const beards = manifest.beards;
const file = readFileSync(join(ASSETS, 'thumbs.png'));

/**
 * Just enough PNG to read our own.
 *
 * The build writes 8-bit RGBA with filter 0 on every row, so this walks the chunks for
 * IHDR and IDAT and inflates. It asserts the shape it assumes rather than guessing, so
 * if the writer ever starts filtering, this says so instead of reading noise.
 */
function decode(buf: Buffer) {
  expect(buf.subarray(0, 8).toString('hex'), 'not a PNG').toBe('89504e470d0a1a0a');
  let at = 8;
  let width = 0, height = 0;
  const idat: Buffer[] = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.subarray(at + 4, at + 8).toString('ascii');
    const body = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      expect(body[8], 'not 8 bits a channel').toBe(8);
      expect(body[9], 'not RGBA').toBe(6);
    }
    if (type === 'IDAT') idat.push(body);
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4 + 1;
  const px = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    expect(raw[y * stride], `row ${y} is filtered`).toBe(0);
    raw.copy(px, y * width * 4, y * stride + 1, y * stride + 1 + width * 4);
  }
  return { width, height, px };
}

const sheet = decode(file);
const { tile, cols, rows, index } = manifest.thumbs;

/** What fraction of a tile has anything opaque in it. */
function covered(at: number) {
  const ox = (at % cols) * tile;
  const oy = Math.floor(at / cols) * tile;
  let on = 0;
  for (let y = 0; y < tile; y++) {
    for (let x = 0; x < tile; x++) {
      if (sheet.px[((oy + y) * sheet.width + ox + x) * 4 + 3] > 0) on++;
    }
  }
  return on / (tile * tile);
}

describe('the piece thumbnails', () => {
  it('is one sheet the size the manifest says', () => {
    expect(sheet.width).toBe(cols * tile);
    expect(sheet.height).toBe(rows * tile);
    expect(file.length, 'the sheet has got heavy').toBeLessThan(300 * 1024);
  });

  it('has a tile for every piece a person can wear, and no spare ones', () => {
    const want = new Set<string>();
    for (const key of LOOKS) for (const slot of SLOT_PARTS) want.add(`${key}:${slot}`);
    // Bald is not a set: it borrows a face and drops the hair, and WHOSE face depends
    // on the person, so there is one of these per set.
    for (const key of LOOKS) want.add(`${key}:bald`);
    // Facial hair is not a set either -- it goes on whatever head you picked -- and is
    // drawn on a face, because a beard alone in a circle is an unreadable smudge.
    for (const name of beards) want.add(`beard:${name}`);
    expect(new Set(Object.keys(index))).toEqual(want);
    expect(Object.keys(index))
      .toHaveLength(WARDROBE.length * (SLOT_PARTS.length + 1) + LOOK_SIZES.beard - 1);
    // Every tile is somewhere different, and inside the sheet.
    const used = Object.values(index);
    expect(new Set(used).size).toBe(used.length);
    for (const at of used) expect(at).toBeLessThan(cols * rows);
  });

  it('draws something in every tile', () => {
    for (const [key, at] of Object.entries(index)) {
      const share = covered(at);
      expect(share, `${key} is an empty square`).toBeGreaterThan(0.02);
      expect(share, `${key} fills its whole tile, so it is not a picture of a thing`)
        .toBeLessThan(0.92);
    }
  });

  it('draws a different picture for every piece', () => {
    // A picker whose forty pictures are the same picture is worse than words. The
    // signature is a coarse grid of what is drawn and roughly what colour: two pairs
    // of plain trousers have the SAME OUTLINE and differ only in being navy and
    // black, so shape alone called them identical.
    const shapes = new Map<string, string>();
    for (const [key, at] of Object.entries(index)) {
      const ox = (at % cols) * tile, oy = Math.floor(at / cols) * tile;
      let sig = '';
      for (let y = 0; y < tile; y += 8) {
        for (let x = 0; x < tile; x += 8) {
          const px = ((oy + y) * sheet.width + ox + x) * 4;
          sig += sheet.px[px + 3] === 0 ? '.'
            : String.fromCharCode(65 + (sheet.px[px]! >> 5) * 8 + (sheet.px[px + 1]! >> 5));
        }
      }
      const clash = shapes.get(sig);
      // One pair is allowed to be identical, and says so: the workwear head is a hard
      // hat with no hair under it, so taking the hair off changes nothing at all.
      const twin = clash && [clash, key].sort().join(' ') === `${LOOKS[4]}:bald ${LOOKS[4]}:head`;
      expect(twin || clash === undefined, `${key} looks exactly like ${clash}`).toBe(true);
      shapes.set(sig, key);
    }
  });

  it('draws every beard on a face, and one per catalog entry after Clean', () => {
    // A beard in a circle on its own is an unreadable smudge, so each tile is the
    // men's bald face with the beard on it -- which is also what they will see.
    expect(beards).toHaveLength(LOOK_SIZES.beard - 1);
    const clean = tileOf('beard', 0);
    expect(clean, 'Clean has no picture').not.toBeNull();
    const seen = new Set<string>();
    for (let i = 1; i < LOOK_SIZES.beard; i++) {
      const at = tileOf('beard', i);
      expect(at, `beard ${i} has no picture`).not.toBeNull();
      expect(at, `beard ${i} is drawn as a clean face`).not.toEqual(clean);
      const id = `${at!.col},${at!.row}`;
      expect(seen.has(id), `beard ${i} shares a tile with another one`).toBe(false);
      seen.add(id);
    }
  });

  it('gives a man and a woman a different bald head', () => {
    // THE BUG THIS EXISTS FOR: bald borrowed the first face in the file every time --
    // a man's -- and the men in this pack are modelled with a darker patch over the
    // jaw. With hair on that is a jawline. On a bald woman it is a beard.
    expect(BALD).toBe(LOOKS.length);
    const man = tileOf('head', BALD, 0);
    const woman = tileOf('head', BALD, 1);
    expect(man, 'a man has no bald head').not.toBeNull();
    expect(woman, 'a woman has no bald head').not.toBeNull();
    expect(woman, 'a bald woman is drawn as a bald man').not.toEqual(man);
    expect(LOOKS[baldBase(0)]!.startsWith('m_'), 'a bald man borrows a woman\'s face').toBe(true);
    expect(LOOKS[baldBase(1)]!.startsWith('w_'), 'a bald woman borrows a man\'s face').toBe(true);
  });
});
