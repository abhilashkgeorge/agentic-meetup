/**
 * The emergency pickup's poses, drawn offline at a size you can see (crowd-gpu.ts
 * hangPose, joltPose, chutePose, flarePose).
 *
 *     npx tsx scripts/render-pickup.mts <out.png>
 *
 * WHY (the founder, 2026-10-03: "the animation still looks bad. please research how to
 * implement it right"). On the phone the person is a few dozen pixels high in the sky;
 * this draws them big. Row 1: the jolt, then hanging at three swings (behind, under,
 * ahead of the balloon), from the side. Row 2: the same from the front. Row 3: under the
 * canopy at three swings and the flare, from the side. The thin line is the rope (from
 * the hook) or the risers (to the hands), so where the anchor is can be checked.
 */
import { writeFileSync } from 'node:fs';
import { STARTER, type Look } from '@clone/shared';
import { BODY_K, HOOK, RISER } from '../src/features/world/flight';
import { dressed, draw, loadPeople, png, sheetOf, view, type Drawn } from './raster.mts';

type Ctor = { new (type: string, init?: Record<string, unknown>): Event };
(globalThis as Record<string, unknown>).ProgressEvent ??= class extends Event {
  constructor(type: string, init: Record<string, unknown> = {}) { super(type); Object.assign(this, init); }
} as unknown as Ctor;

const out = process.argv[2] ?? 'pickup.png';
const her: Look = { ...STARTER, figure: 1, head: 6, top: 6, legs: 6, feet: 6, skin: 3, hairColor: 1 };
const W = 300, H = 400;
const bg = [0.86, 0.92, 0.98] as [number, number, number];

/** A thin vertical bar up from the anchor, standing in for the rope or the risers. */
function line(at: { y: number; z: number }, up: number): Drawn {
  const x0 = -0.008, x1 = 0.008, y0 = at.y / BODY_K, y1 = y0 + up, z = at.z / BODY_K;
  const pos = new Float32Array([x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z]);
  const nrm = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  return { pos, nrm, index: new Uint32Array([0, 1, 2, 0, 2, 3]), rgb: [0.2, 0.2, 0.22] };
}

const tiles: Float32Array[] = [];
const frame = { fit: { pad: 0.06 } as const, background: bg };
const poses: ({ hang: number } | 'jolt')[] = ['jolt', { hang: 0.45 }, { hang: 0 }, { hang: -0.45 }];
for (const yaw of [-Math.PI / 2, 0]) {
  for (const p of poses) {
    const people = await loadPeople(p);
    tiles.push(draw([...dressed(people, her), line(HOOK, 0.9)], W, H, { ...frame, view: view(yaw, 0.05) }));
  }
}
const chutes: ({ chute: number } | 'flare')[] = [{ chute: 0.4 }, { chute: 0 }, { chute: -0.4 }, 'flare'];
for (const p of chutes) {
  const people = await loadPeople(p);
  tiles.push(draw([...dressed(people, her), line(RISER, 0.6)], W, H, { ...frame, view: view(-Math.PI / 2, 0.05) }));
}
const sheet = sheetOf(tiles, 4, W, H, true);
writeFileSync(out, png(sheet.w, sheet.h, sheet.px));
console.log(`wrote ${out}`);
