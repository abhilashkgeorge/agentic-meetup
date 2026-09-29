/**
 * Draw whole characters, dressed exactly as the app dresses them, into contact sheets.
 *
 *     npx tsx scripts/render-looks.mts <sheet> <out.png> [--region head|waist|feet|neck|body] [--back]
 *
 * WHY (the founder, 2026-09-29: "try every combination here for the dress to see if
 * everything looks great"). Any top can go with any trousers, any hairstyle with any
 * face and any hat with any hairstyle -- and a gap at the waist, a boot through a
 * trouser leg or a skull through a haircut only shows where the two meet. This draws
 * every pairing that can go wrong, side by side, so a person can look at all of them
 * at once. Every tile in a sheet is drawn at one scale, so sizes compare.
 *
 * Sheets (rows by the first, columns by the second, in catalog order):
 *   top-legs, legs-feet, head-top   every pairing of two slots
 *   hair-face                       every hairstyle on every face
 *   hat-hair                        every hat on every hairstyle
 *   extras                          everything worn on top, on every face
 *   body                            the neck things and the bags, on every top
 *   beards                          every beard on every men's face
 */
import { writeFileSync } from 'node:fs';
import { HAIRSTYLES, HATS, LOOK_SIZES, SHAVED, STARTER, WARDROBE, WARDROBE_FIGURE, type Look } from '@clone/shared';
import { dressed, draw, loadPeople, png, sheetOf, view, type Frame } from './raster.mts';

// --sit: sitting on a bench (sitPose), to see that the pose sits.
const people = await loadPeople(process.argv.includes('--sit') ? 'sit' : 'idle');
const SETS = WARDROBE.map((_, i) => i);
const HAIRS = HAIRSTYLES.map((_, i) => i);
const look = (over: Partial<Look>): Look => ({ ...STARTER, skin: 2, hairColor: 2, outfitColor: 2, ...over });
const fig = (set: number) => WARDROBE_FIGURE[set] ?? 0;

/** Rows of looks: every pairing of two slots, the rest held at a plain set. */
function pairs(a: 'top' | 'legs' | 'head', b: 'legs' | 'feet' | 'top'): Look[][] {
  return SETS.map((i) => SETS.map((j) => look({ figure: fig(i), [a]: i, [b]: j })));
}

const SHEETS: Record<string, () => Look[][]> = {
  'top-legs': () => pairs('top', 'legs'),
  'legs-feet': () => pairs('legs', 'feet'),
  'head-top': () => pairs('head', 'top'),
  'hair-face': () => HAIRS.map((h) => SETS.map((f) => look({ figure: fig(f), head: f, hair: h }))),
  'hat-hair': () => HAIRS.map((h) => HATS.map((_, t) => look({ head: 0, hair: h, hat: t }))),
  extras: () => SETS.map((f) => [
    ...[1, 2, 3].map((g) => look({ figure: fig(f), head: f, hair: f, glasses: g })),
    ...[1, 2].map((e) => look({ figure: fig(f), head: f, hair: f, earrings: e })),
    ...[1, 2, 3].map((n) => look({ figure: fig(f), head: f, hair: f, top: f, legs: f, neck: n })),
    ...[1, 2].map((b) => look({ figure: fig(f), head: f, hair: f, top: f, legs: f, bag: b })),
  ]),
  // What is worn on the body, on every top, front and (--back) behind: the scarf, the
  // necklace, the bow tie and the two bags.
  body: () => SETS.map((t) => [0, 1, 2, 3].map((n) => look({ figure: fig(t), head: t, hair: t, top: t, legs: t, feet: t, neck: n }))
    .concat([1, 2].map((b) => look({ figure: fig(t), head: t, hair: t, top: t, legs: t, feet: t, bag: b })))),
  // A few people, big, to look at a pose (with --sit and --side).
  few: () => [[look({}), look({ figure: 1, head: 1, hair: 1, top: 1, legs: 6, feet: 6 }), look({ top: 8, legs: 8, feet: 8, head: 8, hair: 8 })]],
  beards: () => SETS.filter((f) => fig(f) === 0).map((f) =>
    Array.from({ length: LOOK_SIZES.beard }, (_, b) => look({ head: f, hair: SHAVED, beard: b }))),
};

const REGIONS: Record<string, [number, number]> = {
  body: [-0.02, 1.95], head: [1.45, 1.95], waist: [0.8, 1.35], feet: [-0.02, 0.45], neck: [1.25, 1.7], torso: [0.85, 1.75],
};

const [name, out, ...rest] = process.argv.slice(2);
const regionName = rest.includes('--region') ? rest[rest.indexOf('--region') + 1] ?? 'body' : 'body';
const band = REGIONS[regionName];
if (!name || !out || !SHEETS[name] || !band) {
  console.error(`usage: render-looks.mts <${Object.keys(SHEETS).join('|')}> <out.png> [--region ${Object.keys(REGIONS).join('|')}]`);
  process.exit(1);
}
const rows = SHEETS[name]!();
const TH = regionName === 'body' ? 260 : 150;
const TW = rest.includes('--side') || name === 'few' ? 260 : 150;
const cols = Math.max(...rows.map((r) => r.length));
// --back: from behind and a little to the side, where a haircut meets the neck.
const frame: Frame = {
  fit: { band }, background: [0.93, 0.93, 0.95],
  view: rest.includes('--back') ? view(Math.PI - 0.5) : rest.includes('--side') ? view(-Math.PI / 2) : view(),
};
const tiles = rows.flatMap((row) => Array.from({ length: cols }, (_, c) =>
  row[c] ? draw(dressed(people, row[c]!), TW, TH, frame) : new Float32Array(TW * TH * 4)));
const sheet = sheetOf(tiles, cols, TW, TH, true);
writeFileSync(out, png(sheet.w, sheet.h, sheet.px));
console.log(`${out}: ${rows.length} rows x ${cols} columns (${regionName})`);
