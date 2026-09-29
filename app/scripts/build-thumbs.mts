/**
 * A picture of every choice the builder offers, drawn once, shipped as one PNG.
 *
 *     npx tsx scripts/build-thumbs.mts            # after build-characters.mjs
 *
 * WHY THIS EXISTS. The builder used to be a wall of words -- "Punk", "Overalls",
 * "Trouser suit" -- and nobody knows what "Overalls" looks like in this pack until
 * they tap it and look at their own character. A picker shows you the thing.
 *
 * WHY IT IS A BUILD STEP AND NOT A LITTLE 3D VIEW PER CHIP. Seventy little GL canvases
 * on a phone is seventy contexts and seventy frame loops. These are pictures of things
 * that never change, so they are drawn once here (scripts/raster.mts, no GL) and
 * shipped as one sprite sheet the app crops with an offset. One decode, one texture.
 *
 * WHAT IT DRAWS, all dressed by the app's own `partsOf` in the starter colours, in the
 * pose the file stores (arms down):
 *   - every face, with no hair on it;
 *   - every hairstyle, on a face of the figure it was modelled for;
 *   - every top, pair of trousers and pair of shoes;
 *   - every beard, on the first men's face;
 *   - every hat and every pair of glasses, on that face with short hair; the
 *     earrings on it turned to show an ear; what goes round the neck on a bust; the
 *     bags on a torso, the backpack from behind.
 * "None" and "As made" have no picture: the builder says them in words.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXTRA_PARTS, LOOK_SIZES, SHAVED, STARTER, WARDROBE_FIGURE, type Look } from '@clone/shared';
import { LOOKS } from '../src/features/world/character';
import { ASSETS, dressed, draw, loadPeople, png, sheetOf, view, type Frame, type Keep } from './raster.mts';

/** One tile. 128 is two of the 64-point chips the picker draws at, on a 2x screen. */
const TILE = 128;
const COLS = 8;

const people = await loadPeople('stored');
const look = (over: Partial<Look>): Look => ({ ...STARTER, ...over });
const only = (...worn: string[]): Keep => (t) => worn.includes(t.worn);

/** The first face of each figure: whose face a hairstyle or a hat is shown on. */
const FACE = [WARDROBE_FIGURE.indexOf(0), WARDROBE_FIGURE.indexOf(1)] as const;
/** Short enough to sit under every hat. */
const CREW_CUT = 4;

const fit: Frame = { fit: { pad: 0.1 } };
const tiles: Float32Array[] = [];
const index: Record<string, number> = {};
const add = (key: string, l: Look, keep: Keep, frame: Frame = fit) => {
  index[key] = tiles.length;
  tiles.push(draw(dressed(people, l, keep), TILE, TILE, frame));
};

for (let set = 0; set < LOOKS.length; set++) {
  const key = LOOKS[set]!;
  const figure = WARDROBE_FIGURE[set] ?? 0;
  add(`${key}:face`, look({ figure, head: set, hair: SHAVED }), only('head'));
  add(`${key}:hair`, look({ figure, head: FACE[figure], hair: set }), only('head', 'hair'));
  add(`${key}:top`, look({ figure, top: set }), only('top'));
  add(`${key}:legs`, look({ figure, legs: set }), only('legs'));
  add(`${key}:feet`, look({ figure, feet: set }), only('feet'));
}

// Facial hair, drawn ON a face: a beard alone in a circle is an unreadable smudge.
people.beards.forEach((mesh, i) => add(`beard:${mesh}`, look({ head: FACE[0], hair: SHAVED, beard: i + 1 }), only('head', 'beard')));

// What people wear on top, on somebody, framed on where it is worn.
const head = { head: FACE[0], hair: CREW_CUT };
const FRAMES: Record<(typeof EXTRA_PARTS)[number], { l: Partial<Look>; keep: Keep; frame: Frame }> = {
  hat: { l: head, keep: only('head', 'hair', 'hat', 'extra'), frame: fit },
  glasses: { l: head, keep: only('head', 'hair', 'extra'), frame: fit },
  earrings: { l: head, keep: only('head', 'hair', 'extra'), frame: { fit: { pad: 0.1 }, view: view(-1.05, 0.06) } },
  neck: { l: head, keep: only('head', 'hair', 'top', 'extra'), frame: { fit: { pad: 0.08 }, clipY: [1.22, 1.78] } },
  bag: { l: {}, keep: only('top', 'extra'), frame: { fit: { pad: 0.08 }, clipY: [0.8, 1.62] } },
};
for (const part of EXTRA_PARTS) {
  const { l, keep, frame } = FRAMES[part];
  for (let i = 1; i < LOOK_SIZES[part]; i++) {
    // The backpack is a backpack from behind; from the front it is two straps.
    const f = part === 'bag' && i === 1 ? { ...frame, view: view(Math.PI - 0.6, 0.06) } : frame;
    add(`${part}:${i}`, look({ ...l, [part]: i }), keep, f);
  }
}

const sheet = sheetOf(tiles, COLS, TILE, TILE);
const file = png(sheet.w, sheet.h, sheet.px);
writeFileSync(join(ASSETS, 'thumbs.png'), file);

const manifest = people.manifest as typeof people.manifest & { thumbs?: unknown };
manifest.thumbs = { tile: TILE, cols: COLS, rows: Math.ceil(tiles.length / COLS), index };
writeFileSync(join(ASSETS, 'people.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`thumbs.png  ${sheet.w}x${sheet.h}  ${tiles.length} tiles  ${(file.length / 1024).toFixed(0)} KB`);
