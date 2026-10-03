/**
 * The emergency pickup, filmed offline from the app's own code: the flight and the camera
 * (flight.ts flightAt, flightShot), the frames the crowd shows and how it blends them
 * (crowd-gpu.ts bakeClips, rigRows), and the gear (plane-mesh.ts, and the cable and
 * canopy as rig-mesh.ts draws them) -- for watching the whole of it without a second
 * person in the park.
 *
 *     npx tsx scripts/film-pickup.mts <out.mp4> [distance=24]
 *
 * Left, the phone held upright, through the camera the app uses, the park's cards and
 * buttons shaded over the bottom; right, from the side, wide enough for all of it. Needs
 * ffmpeg. Draws with raster.mts, flat-shaded.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STARTER, type Look } from '@clone/shared';
import { BODY_K, CANOPY_ABOVE, cableCurve, flightAt, flightMs, flightShot, type Flight, type FlightPose } from '../src/features/world/flight';
import { PROP_HUBS, bladeGeometry, planeGeometry } from '../src/features/world/plane-mesh';
import { WALK_AIM, WALK_BACK, WALK_EYE, WALK_FOV, WALK_RISE, followPose } from '../src/features/world/camera';
import { bakeClips, rigRows } from '../src/features/world/crowd-gpu';
import { ASSETS, dressed, draw, loadPeople, png, view, type Drawn, type RGB } from './raster.mts';

type Ctor = { new (type: string, init?: Record<string, unknown>): Event };
(globalThis as Record<string, unknown>).ProgressEvent ??= class extends Event {
  constructor(type: string, init: Record<string, unknown> = {}) { super(type); Object.assign(this, init); }
} as unknown as Ctor;

const out = process.argv[2] ?? 'pickup.mp4';
const D = Number(process.argv[3] ?? 24);
const FPS = 30;
/** The phone's panel, a Pixel's shape at 0.4 of its pixels; the side view beside it. */
const W = 432, H = 960, SW = 540;
/** How much of the phone's height, from the bottom, the park's cards and buttons cover. */
const HUD = Number(process.env.HUD ?? 0.3);
const SKY: RGB = [0.83, 0.9, 0.97];
const her: Look = { ...STARTER, figure: 1, head: 6, top: 6, legs: 6, feet: 6, skin: 3, hairColor: 1 };
const ACCENT = '#6D5DFC'; // the light theme's accent, as the canopy and the plane are drawn
const accent = new THREE.Color(ACCENT);

// The bake, as the phone makes it: one row per frame, a skinning matrix per bone.
const buf = readFileSync(join(ASSETS, 'people.glb'));
const gltf = await new Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>((res, rej) =>
  new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '', res as never, rej));
const meshes: THREE.SkinnedMesh[] = [];
gltf.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
const names = meshes[0]!.skeleton.bones.map((b) => b.name);
const bake = bakeClips(gltf.scene, names, meshes[0]!.skeleton.boneInverses, new Map(gltf.animations.map((c) => [c.name, c])));

// The people to dress, posed per frame by setting each bone so that its skinning matrix
// is the blend the shader makes: M = (1 - w) * row a + w * row b.
const people = await loadPeople('stored');
const any = people.byName.values().next().value as THREE.SkinnedMesh;
const bindOf = new Map(any.skeleton.bones.map((b, i) => [b.name, any.skeleton.boneInverses[i]!.clone().invert()]));
function pose(rows: { a: number; b: number; w: number }): void {
  const m = new THREE.Matrix4(), ma = new THREE.Matrix4(), mb = new THREE.Matrix4();
  for (const b of any.skeleton.bones) {
    const i = names.indexOf(b.name);
    ma.fromArray(bake.data, (rows.a * bake.width + i * 4) * 4);
    mb.fromArray(bake.data, (rows.b * bake.width + i * 4) * 4);
    for (let k = 0; k < 16; k++) m.elements[k] = ma.elements[k]! * (1 - rows.w) + mb.elements[k]! * rows.w;
    b.matrixWorld.multiplyMatrices(m, bindOf.get(b.name)!);
  }
}

/** A part moved by a matrix: positions and normals. */
function moved(part: Drawn, m: THREE.Matrix4): Drawn {
  const pos = new Float32Array(part.pos.length), nrm = new Float32Array(part.nrm.length);
  const v = new THREE.Vector3(), n3 = new THREE.Matrix3().getNormalMatrix(m);
  for (let i = 0; i < pos.length; i += 3) {
    v.set(part.pos[i]!, part.pos[i + 1]!, part.pos[i + 2]!).applyMatrix4(m);
    pos[i] = v.x; pos[i + 1] = v.y; pos[i + 2] = v.z;
    v.set(part.nrm[i]!, part.nrm[i + 1]!, part.nrm[i + 2]!).applyMatrix3(n3).normalize();
    nrm[i] = v.x; nrm[i + 1] = v.y; nrm[i + 2] = v.z;
  }
  return { pos, nrm, index: part.index, rgb: part.rgb };
}
function fromGeometry(g: THREE.BufferGeometry, rgb: RGB, m: THREE.Matrix4): Drawn {
  const p = g.attributes.position as THREE.BufferAttribute, n = g.attributes.normal as THREE.BufferAttribute;
  const index = g.index ? g.index.array : Uint32Array.from({ length: p.count }, (_, i) => i);
  return moved({ pos: new Float32Array(p.array), nrm: new Float32Array(n.array), index, rgb }, m);
}
/** A geometry coloured per corner, as one part per colour (the rasterizer colours whole parts). */
function byColour(g: THREE.BufferGeometry): Drawn[] {
  const p = g.attributes.position as THREE.BufferAttribute, n = g.attributes.normal as THREE.BufferAttribute, c = g.attributes.color as THREE.BufferAttribute;
  const sets = new Map<string, { pos: number[]; nrm: number[]; rgb: RGB }>();
  for (let i = 0; i < p.count; i += 3) {
    const key = `${c.getX(i).toFixed(3)},${c.getY(i).toFixed(3)},${c.getZ(i).toFixed(3)}`;
    if (!sets.has(key)) sets.set(key, { pos: [], nrm: [], rgb: [c.getX(i), c.getY(i), c.getZ(i)] });
    const s = sets.get(key)!;
    for (let k = 0; k < 3; k++) {
      s.pos.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k));
      s.nrm.push(n.getX(i + k), n.getY(i + k), n.getZ(i + k));
    }
  }
  return [...sets.values()].map((s) => ({ pos: Float32Array.from(s.pos), nrm: Float32Array.from(s.nrm), index: Uint32Array.from({ length: s.pos.length / 3 }, (_, i) => i), rgb: s.rgb }));
}
const planeParts = byColour(planeGeometry(ACCENT));
const bladeParts = byColour(bladeGeometry());

/** The canopy's dome in its two stripe colours, split as rig-mesh.ts colours it: by triangle, round the dome. */
const domes = (() => {
  const dome = new THREE.SphereGeometry(1, 16, 5, 0, Math.PI * 2, 0, Math.PI / 2.3).toNonIndexed();
  const pos = dome.getAttribute('position'), nrm = dome.getAttribute('normal');
  const sets: number[][][] = [[[], []], [[], []]];
  for (let i = 0; i < pos.count; i += 3) {
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const stripe = Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 8) % 2;
    for (let k = 0; k < 3; k++) {
      sets[stripe]![0]!.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
      sets[stripe]![1]!.push(nrm.getX(i + k), nrm.getY(i + k), nrm.getZ(i + k));
    }
  }
  return sets.map(([p, n]) => new THREE.BufferGeometry()
    .setAttribute('position', new THREE.Float32BufferAttribute(p!, 3)).setAttribute('normal', new THREE.Float32BufferAttribute(n!, 3)));
})();

// The park: grass in small tiles (the lens leaves out a triangle with a corner behind it),
// and trees about as tall as the park's, for scale.
const GRASS: RGB = [0.45, 0.62, 0.38], GRASS2: RGB = [0.42, 0.59, 0.36];
const tile = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const trunkGeo = new THREE.CylinderGeometry(0.05, 0.07, 1.8, 6).translate(0, 0.9, 0);
const crownGeo = new THREE.IcosahedronGeometry(0.75, 0).translate(0, 2.3, 0).toNonIndexed();
crownGeo.computeVertexNormals();
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const ground: Drawn[] = [];
for (let x = -20; x < 20; x++) {
  for (let z = -16; z < D + 14; z++) ground.push(fromGeometry(tile, (x + z) % 2 ? GRASS : GRASS2, new THREE.Matrix4().makeTranslation(x + 0.5, 0, z + 0.5)));
}
const trees: Drawn[] = [];
for (let i = 0; i < 46; i++) {
  const x = (rnd() - 0.5) * 24, z = -14 + rnd() * (D + 26);
  if (Math.abs(x) < 1.6) continue; // the way itself kept clear, as the pickup's path would be
  const s = 0.75 + rnd() * 0.7; // garden.ts: a tree's scale, about four units at the most
  const at = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
  trees.push(fromGeometry(trunkGeo, [0.45, 0.34, 0.25], at), fromGeometry(crownGeo, [0.3, 0.5, 0.3], at));
}

/** For the side view, a strip of grass behind the way (a ground seen edge-on would cover everything). */
const strip = fromGeometry(new THREE.BoxGeometry(1, 1, 1), GRASS, new THREE.Matrix4().compose(
  new THREE.Vector3(-2, -0.01, D / 2), new THREE.Quaternion(), new THREE.Vector3(2, 0.02, D + 30)));

type Line = { a: [number, number, number]; b: [number, number, number]; rgb: RGB; px: number };

/** Everything at one instant, in world units: the parts, and the lines (cable, canopy lines). */
function scene(p: FlightPose, ms: number, px: number): { parts: Drawn[]; lines: Line[] } {
  pose(rigRows(p, bake));
  const place = new THREE.Matrix4().compose(
    new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.heading),
    new THREE.Vector3(BODY_K, BODY_K, BODY_K));
  const parts = dressed(people, her).map((d) => moved(d, place));
  const lines: Line[] = [];
  const pl = p.plane;
  if (pl && pl.alpha > 0.3) {
    const at = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-pl.climb, pl.heading, pl.roll, 'YXZ')).setPosition(pl.x, pl.y, pl.z);
    parts.push(...planeParts.map((d) => moved(d, at)));
    PROP_HUBS.forEach(([hx, hy, hz], i) => {
      const spin = new THREE.Matrix4().makeTranslation(hx, hy, hz + 0.015).multiply(new THREE.Matrix4().makeRotationZ(ms * 0.031 + i));
      parts.push(...bladeParts.map((d) => moved(d, at.clone().multiply(spin))));
    });
  }
  if (pl && p.cable) {
    const pts = cableCurve(pl, p.cable, p.heading);
    for (let i = 0; i + 1 < pts.length; i++) lines.push({ a: pts[i]!, b: pts[i + 1]!, rgb: [0.2, 0.2, 0.23], px });
  }
  const a = new THREE.Vector3(p.anchor.x, p.anchor.y, p.anchor.z);
  const open = Math.min(1, Math.max(0, p.chute));
  if (open > 0.01) {
    const top = a.y + CANOPY_ABOVE, w = 0.26 * (0.25 + 0.75 * open), h = 0.11;
    const at = new THREE.Matrix4().compose(new THREE.Vector3(a.x, top - h * 0.5, a.z), new THREE.Quaternion(), new THREE.Vector3(w, h, w));
    parts.push(fromGeometry(domes[1]!, [accent.r, accent.g, accent.b], at), fromGeometry(domes[0]!, [0.97, 0.97, 0.97], at));
    const sx = Math.cos(p.heading), sz = -Math.sin(p.heading), hands = 0.11 * BODY_K, rim = top - h * 0.45;
    for (let k = 0; k < 4; k++) {
      const ang = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const side = Math.cos(ang) * sx + Math.sin(ang) * sz > 0 ? 1 : -1;
      lines.push({ a: [a.x + sx * hands * side, a.y, a.z + sz * hands * side], b: [a.x + Math.cos(ang) * w, rim, a.z + Math.sin(ang) * w], rgb: [0.3, 0.3, 0.3], px: px * 0.8 });
    }
  }
  return { parts, lines };
}

const hop: Flight = { fx: 0, fz: 0, tx: 0, tz: D, kind: 'pickup' };
const total = flightMs(hop) + 700;
const dir = join(process.env.CLAUDE_JOB_DIR ?? '/tmp', 'tmp', 'film-frames');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const lerp3 = (a: readonly number[], b: readonly number[], w: number): [number, number, number] => [0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * w) as [number, number, number];
let n = 0;
for (let ms = 0; ms <= total; ms += 1000 / FPS) {
  const p = flightAt(hop, ms);
  // The phone: the walking camera behind your head, eased into the pickup's own shot and back.
  const walk = followPose(p.x, p.z, p.heading, WALK_BACK, WALK_RISE + p.y, WALK_AIM, WALK_EYE + p.y);
  const shot = flightShot(hop, ms);
  const w = shot?.w ?? 0;
  const eye = shot ? lerp3(walk.eye, shot.eye, w) : walk.eye;
  const look = shot ? lerp3(walk.look, shot.look, w) : walk.look;
  const near = scene(p, ms, 1.2);
  const phone = draw([...ground, ...trees, ...near.parts], W, H, { fit: { pad: 0 }, camera: { eye, look, fov: WALK_FOV }, lines: near.lines, background: SKY });
  // The park's cards and buttons over the bottom of the phone.
  for (let y = Math.floor(H * (1 - HUD)); y < H; y++) {
    for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; for (let c = 0; c < 3; c++) phone[i + c] = phone[i + c]! * 0.55 + 0.45 * 0.93; }
  }
  // From the side: the whole way, the plane and you, flat.
  const mid = Math.max(-1, Math.min(D + 1, p.z));
  const far = scene(p, ms, 1.4);
  const shift = new THREE.Matrix4().makeTranslation(0, -3.6, -mid);
  const side = draw([strip, ...far.parts].map((d) => moved(d, shift)), SW, H, { fit: { band: [-4.6, 4.6] }, view: view(Math.PI / 2, 0.02), background: SKY });
  const px = new Float32Array((W + SW) * H * 4);
  for (let y = 0; y < H; y++) {
    px.set(phone.subarray(y * W * 4, (y + 1) * W * 4), y * (W + SW) * 4);
    px.set(side.subarray(y * SW * 4, (y + 1) * SW * 4), (y * (W + SW) + W) * 4);
  }
  writeFileSync(join(dir, `f${String(n).padStart(4, '0')}.png`), png(W + SW, H, px));
  n++;
}
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', join(dir, 'f%04d.png'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', out]);
console.log(`wrote ${out}: ${n} frames, ${(total / 1000).toFixed(1)} s, a ${D}-unit hop`);
