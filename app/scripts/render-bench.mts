/**
 * Two people sitting on a park bench, drawn offline at the sizes the park draws them.
 *
 *     npx tsx scripts/render-bench.mts <out.png>
 *
 * WHY (the founder, 2026-09-29: "fix scale too wrt to park bench cycle and everything
 * else"). On the phone a bench is a few dozen pixels across, too small to see whether
 * somebody sits on it or in it. This puts the bench (venue-mesh.ts SIZE) and a sitting
 * couple (sitPose, SEAT in ride.ts) in one scene at the same scale, from the front,
 * the side and three-quarters, big enough to look at.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STARTER, type Look } from '@clone/shared';
import { PERSON } from '../src/features/world/camera';
import { MODEL_SCALE } from '../src/features/world/character-mesh';
import { seatOn } from '../src/features/world/ride';
import { SIZE } from '../src/features/world/venue-mesh';
import { APP, dressed, draw, loadPeople, png, sheetOf, view, type Drawn, type RGB } from './raster.mts';

type Ctor = { new (type: string, init?: Record<string, unknown>): Event };
(globalThis as Record<string, unknown>).ProgressEvent ??= class extends Event {
  constructor(type: string, init: Record<string, unknown> = {}) { super(type); Object.assign(this, init); }
} as unknown as Ctor;

const out = process.argv[2] ?? 'bench.png';
/** World units per unit of the character model. Everything is drawn in model units. */
const K = MODEL_SCALE * PERSON;

const b = readFileSync(join(APP, 'assets', 'venues', 'cubbon-park', 'furniture.glb'));
const gltf = await new Promise<{ scene: THREE.Object3D }>((res, rej) =>
  new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res as never, rej));
let bench: THREE.Mesh | null = null;
gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name === 'ParkFurn_Bench_A') bench = o as THREE.Mesh; });
if (!bench) throw new Error('no bench in the GLB');

/** A mesh as triangles in model units, scaled from its own by (sx, sy, sz) / K. */
function asDrawn(geo: THREE.BufferGeometry, s: readonly [number, number, number], rgb: RGB, at: [number, number, number] = [0, 0, 0]): Drawn {
  const p = geo.attributes.position!, n = geo.attributes.normal!;
  const pos = new Float32Array(p.count * 3), nrm = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    pos[i * 3] = (p.getX(i) * s[0]) / K + at[0];
    pos[i * 3 + 1] = (p.getY(i) * s[1]) / K + at[1];
    pos[i * 3 + 2] = (p.getZ(i) * s[2]) / K + at[2];
    nrm[i * 3] = n.getX(i); nrm[i * 3 + 1] = n.getY(i); nrm[i * 3 + 2] = n.getZ(i);
  }
  const index = geo.index ? geo.index.array : Uint32Array.from({ length: p.count }, (_, i) => i);
  return { pos, nrm, index, rgb };
}

/** A person moved in model units. */
const moved = (parts: Drawn[], dx: number, dz: number): Drawn[] => parts.map((d) => {
  const pos = new Float32Array(d.pos);
  for (let i = 0; i < pos.length; i += 3) { pos[i] += dx; pos[i + 2] += dz; }
  return { ...d, pos };
});

const people = await loadPeople('sit');
const her: Look = { ...STARTER, figure: 1, head: 6, top: 6, legs: 6, feet: 6, skin: 3, hairColor: 1 };
const him: Look = { ...STARTER, skin: 2, hairColor: 2, outfitColor: 2 };
const left = seatOn({ x: 0, z: 0, rot: 0 }, true);
const right = seatOn({ x: 0, z: 0, rot: 0 }, false);
const scene: Drawn[] = [
  asDrawn(bench.geometry, SIZE.bench, [0.78, 0.66, 0.5]),
  ...moved(dressed(people, him), left.x / K, left.z / K),
  ...moved(dressed(people, her), right.x / K, right.z / K),
];
// The ground, so where the feet are reads: a thin slab under everything.
const ground = new THREE.BoxGeometry(3.2, 0.01, 2.2).translate(0, -0.005, 0.4);
scene.push(asDrawn(ground, [K, K, K], [0.55, 0.68, 0.45]));

const W = 520, H = 420;
const tiles = [
  draw(scene, W, H, { fit: { pad: 0.06 }, view: view(0, 0.12), background: [0.93, 0.95, 0.97] }),
  draw(scene, W, H, { fit: { pad: 0.06 }, view: view(-Math.PI / 2, 0.05), background: [0.93, 0.95, 0.97] }),
  draw(scene, W, H, { fit: { pad: 0.06 }, view: view(-0.7, 0.3), background: [0.93, 0.95, 0.97] }),
];
const sheet = sheetOf(tiles, 3, W, H, true);
writeFileSync(out, png(sheet.w, sheet.h, sheet.px));
console.log(`wrote ${out}: front, side, three-quarters`);
