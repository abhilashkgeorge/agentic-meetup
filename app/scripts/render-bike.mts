/**
 * A rider on a bicycle, drawn offline at a quarter-turn of the cranks apart, from the
 * side, the front and three-quarters -- to see that they sit on it, hold it and pedal it.
 *
 *     npx tsx scripts/render-bike.mts <out.png>
 *
 * The bicycle (bike-mesh.ts) and the pose (crowd-gpu.ts ridePose) are both made from
 * bike.ts's points; this is the look that says they agree.
 */
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { STARTER, type Look } from '@clone/shared';
import { buildBike } from '../src/features/world/bike-mesh';
import { dressed, draw, loadPeople, png, sheetOf, view, type Drawn } from './raster.mts';

const out = process.argv[2] ?? 'bike.png';
const bike = buildBike();
const pos = bike.attributes.position!, nrm = bike.attributes.normal!, col = bike.attributes.color!;
// The bike's triangles, a colour each, as the rasteriser wants them: one part per colour.
const byColour = new Map<string, { pos: number[]; nrm: number[] }>();
for (let t = 0; t < pos.count; t += 3) {
  const key = [col.getX(t), col.getY(t), col.getZ(t)].map((c) => c.toFixed(3)).join(',');
  const into = byColour.get(key) ?? { pos: [], nrm: [] };
  for (let k = 0; k < 3; k++) {
    into.pos.push(pos.getX(t + k), pos.getY(t + k), pos.getZ(t + k));
    into.nrm.push(nrm.getX(t + k), nrm.getY(t + k), nrm.getZ(t + k));
  }
  byColour.set(key, into);
}
const toSRGB = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const bikeParts: Drawn[] = [...byColour].map(([k, v]) => ({
  pos: new Float32Array(v.pos), nrm: new Float32Array(v.nrm),
  index: Uint32Array.from({ length: v.pos.length / 3 }, (_, i) => i),
  rgb: k.split(',').map((c) => toSRGB(Number(c))) as [number, number, number],
}));
const look: Look = { ...STARTER, skin: 2, hairColor: 2, outfitColor: 2 };
const W = 360, H = 360;
const tiles: Float32Array[] = [];
for (const yaw of [-Math.PI / 2, 0, -0.7]) {
  for (const phase of [0, 0.25, 0.5, 0.75]) {
    const people = await loadPeople({ ride: phase });
    const scene = [...bikeParts, ...dressed(people, look)];
    tiles.push(draw(scene, W, H, { fit: { pad: 0.05 }, view: view(yaw, 0.08), background: [0.93, 0.95, 0.97] }));
  }
}
const sheet = sheetOf(tiles, 4, W, H, true);
writeFileSync(out, png(sheet.w, sheet.h, sheet.px));
console.log(`wrote ${out}: side, front, three-quarters, each at four places in the turn of the cranks`);
void THREE;
