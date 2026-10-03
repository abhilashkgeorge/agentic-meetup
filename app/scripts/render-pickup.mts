/**
 * Somebody hanging from the emergency pickup's rope, and coming down under the parachute,
 * drawn offline at a size you can see (crowd-gpu.ts hangPose, chutePose).
 *
 *     npx tsx scripts/render-pickup.mts <out.png>
 *
 * WHY (the founder, 2026-10-03: "the rope should be hooked to a person's back and you can
 * give actions to hands and legs (animate it) like he is being pulled and dropped"). On
 * the phone the person is a few dozen pixels high in the sky; this draws the poses big,
 * four moments of the kick from the front and the side, and two of the parachute's sway.
 */
import { writeFileSync } from 'node:fs';
import { STARTER, type Look } from '@clone/shared';
import { dressed, draw, loadPeople, png, sheetOf, view } from './raster.mts';

type Ctor = { new (type: string, init?: Record<string, unknown>): Event };
(globalThis as Record<string, unknown>).ProgressEvent ??= class extends Event {
  constructor(type: string, init: Record<string, unknown> = {}) { super(type); Object.assign(this, init); }
} as unknown as Ctor;

const out = process.argv[2] ?? 'pickup.png';
const her: Look = { ...STARTER, figure: 1, head: 6, top: 6, legs: 6, feet: 6, skin: 3, hairColor: 1 };
const W = 300, H = 380;
const bg = [0.86, 0.92, 0.98] as [number, number, number];
const tiles: Float32Array[] = [];
for (const phase of [0, 0.25, 0.5, 0.75]) {
  const people = await loadPeople({ hang: phase });
  tiles.push(draw(dressed(people, her), W, H, { fit: { pad: 0.08 }, view: view(0, 0.05), background: bg }));
}
for (const phase of [0, 0.25, 0.5, 0.75]) {
  const people = await loadPeople({ hang: phase });
  tiles.push(draw(dressed(people, her), W, H, { fit: { pad: 0.08 }, view: view(-Math.PI / 2, 0.05), background: bg }));
}
for (const phase of [0, 0.5]) {
  const people = await loadPeople({ chute: phase });
  tiles.push(draw(dressed(people, her), W, H, { fit: { pad: 0.08 }, view: view(0, 0.05), background: bg }));
  tiles.push(draw(dressed(people, her), W, H, { fit: { pad: 0.08 }, view: view(-Math.PI / 2, 0.05), background: bg }));
}
const sheet = sheetOf(tiles, 4, W, H, true);
writeFileSync(out, png(sheet.w, sheet.h, sheet.px));
console.log(`wrote ${out}: hanging (front x4, side x4), parachute (front, side x2)`);
