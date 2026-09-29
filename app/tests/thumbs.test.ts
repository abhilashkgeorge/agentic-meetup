/**
 * The picture of every choice, checked as a picture.
 *
 * `scripts/build-thumbs.mts` rasterises sixty-nine tiles by hand -- there is no GL in
 * Node -- and the first run of its ancestor wrote a perfectly valid PNG of EMPTY
 * SQUARES, because the z-buffer started at +Infinity and rejected every fragment. It
 * was a 3 KB file instead of 100 KB and nothing threw. So this does not check that the
 * sheet exists; it decodes it and checks that something was actually drawn in every
 * tile, and that what was drawn is where the manifest says it is.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - fill the z-buffer in scripts/raster.mts with +Infinity -> "draws something in
 *     every tile" fails, every tile comes back empty.
 *   - leave the hats out of build-thumbs.mts -> "has a tile for every choice" fails.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { EXTRA_PARTS, HAIRSTYLES, LOOK_SIZES, NOT_OFFERED, SHAVED } from '@clone/shared';
import { LOOKS } from '../src/features/world/character';
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

  it('has a tile for every choice that has a picture, and no spare ones', () => {
    const want = new Set<string>();
    // Each set's face (no hair), its hairstyle (on a face), and its three clothes.
    for (const key of LOOKS) for (const what of ['face', 'hair', 'top', 'legs', 'feet']) want.add(`${key}:${what}`);
    // Facial hair is not a set -- it goes on whatever face you picked -- and is drawn on
    // a face, because a beard alone in a circle is an unreadable smudge.
    for (const name of beards) want.add(`beard:${name}`);
    // Everything worn on top, bar "None", which the builder says in words.
    for (const part of EXTRA_PARTS) for (let i = 1; i < LOOK_SIZES[part]; i++) want.add(`${part}:${i}`);
    expect(new Set(Object.keys(index))).toEqual(want);
    expect(Object.keys(index)).toHaveLength(69);
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
    const TWINS = new Set([
      [`${LOOKS[3]}:feet`, `${LOOKS[9]}:feet`],
      [`${LOOKS[1]}:hair`, `${LOOKS[9]}:hair`],
    ].map((pair) => pair.sort().join(' ')));
    // ...and the builder offers neither copy.
    expect(NOT_OFFERED.feet).toEqual([9]);
    expect(NOT_OFFERED.hair).toEqual([9]);
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
      // The pack ships two pieces twice, and the builder does not offer the copies
      // (NOT_OFFERED): the trouser suit's shoes are the overalls' shoes, and Long
      // (straight) is Long.
      const twin = clash !== undefined && TWINS.has([clash, key].sort().join(' '));
      if (!twin) expect(clash, `${key} looks exactly like ${clash}`).toBeUndefined();
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

  it('pictures Shaved and Clean as the men\'s face, and every other hairstyle with its hair on', () => {
    const face = tileOf('head', 0);
    expect(face, 'the first face has no picture').not.toBeNull();
    expect(tileOf('hair', SHAVED), 'Shaved is not a shaved head').toEqual(face);
    expect(tileOf('beard', 0), 'Clean is not a clean face').toEqual(face);
    for (let i = 0; i < HAIRSTYLES.length; i++) {
      if (i === SHAVED) continue;
      const at = tileOf('hair', i);
      expect(at, `${HAIRSTYLES[i]} has no picture`).not.toBeNull();
      expect(at, `${HAIRSTYLES[i]} is drawn as a face with no hair`).not.toEqual(tileOf('head', i));
    }
  });

  it('has no picture for "None", and one for everything else worn on top', () => {
    for (const part of EXTRA_PARTS) {
      expect(tileOf(part, 0), `"None" of ${part} is drawn`).toBeNull();
      for (let i = 1; i < LOOK_SIZES[part]; i++) expect(tileOf(part, i), `${part} ${i} has no picture`).not.toBeNull();
    }
  });
});
