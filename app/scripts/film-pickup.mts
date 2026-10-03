/**
 * The emergency pickup, filmed offline from the app's own code: the flight (flight.ts),
 * the frames the crowd shows and how it blends them (crowd-gpu.ts bakeClips, rigRows),
 * and the gear (the same balloon, rope and canopy as rig-mesh.ts) -- for watching the
 * whole of it without a second person in the park.
 *
 *     npx tsx scripts/film-pickup.mts <out.mp4> [distance=24]
 *
 * Left, from the side, wide enough for the balloon and the canopy; right, the body close
 * up from three-quarters front. Both follow the person. Needs ffmpeg. Draws with
 * raster.mts, flat-shaded, without perspective.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STARTER, type Look } from '@clone/shared';
import { BALLOON_R, BODY_K, CANOPY_ABOVE, flightAt, flightMs, type Flight, type FlightPose } from '../src/features/world/flight';
import { bakeClips, rigRows } from '../src/features/world/crowd-gpu';
import { ASSETS, dressed, draw, loadPeople, png, view, type Drawn, type RGB } from './raster.mts';

type Ctor = { new (type: string, init?: Record<string, unknown>): Event };
(globalThis as Record<string, unknown>).ProgressEvent ??= class extends Event {
  constructor(type: string, init: Record<string, unknown> = {}) { super(type); Object.assign(this, init); }
} as unknown as Ctor;

const out = process.argv[2] ?? 'pickup.mp4';
const D = Number(process.argv[3] ?? 24);
const FPS = 30;
const W = 540, H = 960;
const SKY: RGB = [0.83, 0.9, 0.97];
const her: Look = { ...STARTER, figure: 1, head: 6, top: 6, legs: 6, feet: 6, skin: 3, hairColor: 1 };
const ACCENT = new THREE.Color('#6D5DFC'); // the light theme's accent, as the canopy is drawn

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
const balloonGeo = new THREE.SphereGeometry(1, 18, 12);
const ropeGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
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
const lineGeo = new THREE.CylinderGeometry(1, 1, 1, 4, 1, true).translate(0, 0.5, 0);
// The ground: a field under the park camera, and for the side view a strip BEHIND the
// flight (a plane seen nearly edge-on in this orthographic view would cover everything).
const GRASS: RGB = [0.45, 0.62, 0.38];
const field = new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2);
const strip = new THREE.BoxGeometry(1, 1, 1);

/** A stick from a to b, `r` thick. */
function stick(a: THREE.Vector3, b: THREE.Vector3, r: number, rgb: RGB): Drawn {
  const d = b.clone().sub(a);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  return fromGeometry(lineGeo, rgb, new THREE.Matrix4().compose(a, q, new THREE.Vector3(r, d.length(), r)));
}

/** Everything at one instant, in world units. */
function scene(p: FlightPose): Drawn[] {
  pose(rigRows(p, bake));
  const place = new THREE.Matrix4().compose(
    new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.heading),
    new THREE.Vector3(BODY_K, BODY_K, BODY_K));
  const parts = dressed(people, her).map((d) => moved(d, place));
  const a = new THREE.Vector3(p.anchor.x, p.anchor.y, p.anchor.z);
  const b = p.balloon;
  if (b && b.alpha > 0.01) {
    parts.push(fromGeometry(balloonGeo, [0.95, 0.94, 0.9], new THREE.Matrix4().compose(
      new THREE.Vector3(b.x, b.y, b.z), new THREE.Quaternion(), new THREE.Vector3(BALLOON_R * b.size, BALLOON_R * b.size * 1.18, BALLOON_R * b.size))));
    if (p.roped) parts.push(stick(a, new THREE.Vector3(b.x, b.y - BALLOON_R * b.size * 1.1, b.z), 0.006, [0.24, 0.24, 0.24]));
  }
  const open = Math.min(1, Math.max(0, p.chute));
  if (open > 0.01) {
    const top = a.y + CANOPY_ABOVE, w = 0.26 * (0.25 + 0.75 * open), h = 0.11;
    const at = new THREE.Matrix4().compose(new THREE.Vector3(a.x, top - h * 0.5, a.z), new THREE.Quaternion(), new THREE.Vector3(w, h, w));
    parts.push(fromGeometry(domes[1]!, [ACCENT.r, ACCENT.g, ACCENT.b], at), fromGeometry(domes[0]!, [0.97, 0.97, 0.97], at));
    const sx = Math.cos(p.heading), sz = -Math.sin(p.heading), hands = 0.11 * BODY_K, rim = top - h * 0.45;
    for (let k = 0; k < 4; k++) {
      const ang = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const side = Math.cos(ang) * sx + Math.sin(ang) * sz > 0 ? 1 : -1;
      parts.push(stick(new THREE.Vector3(a.x + sx * hands * side, a.y, a.z + sz * hands * side),
        new THREE.Vector3(a.x + Math.cos(ang) * w, rim, a.z + Math.sin(ang) * w), 0.0015, [0.3, 0.3, 0.3]));
    }
  }
  return parts;
}

/** Drawn with the camera's target at the middle: everything moved so `target` is the origin. */
function shot(parts: Drawn[], target: THREE.Vector3, yaw: number, pitch: number, span: number): Float32Array {
  const shift = new THREE.Matrix4().makeTranslation(-target.x, -target.y, -target.z);
  return draw(parts.map((d) => moved(d, shift)), W, H, { fit: { band: [-span / 2, span / 2] }, view: view(yaw, pitch), background: SKY });
}
const sideGround = (d: number) => fromGeometry(strip, GRASS, new THREE.Matrix4().compose(
  new THREE.Vector3(d / 2, -0.01, -2), new THREE.Quaternion(), new THREE.Vector3(d + 8, 0.02, 3)));
const parkGround = (d: number) => fromGeometry(field, GRASS, new THREE.Matrix4().makeTranslation(d / 2, 0, 0));

const hop: Flight = { fx: 0, fz: 0, tx: D, tz: 0, kind: 'pickup' };
const total = flightMs(hop) + 600;
const dir = join(process.env.CLAUDE_JOB_DIR ?? '/tmp', 'tmp', 'film-frames');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
let n = 0;
for (let ms = 0; ms <= total; ms += 1000 / FPS) {
  const p = flightAt(hop, ms);
  const parts = scene(p);
  // Locked on the person: the yank is too quick for an eased camera. The wide shot looks
  // a little above them, for the balloon and the canopy; the close one between the anchor
  // and the feet, so the body stays in frame however it swings.
  const wide = new THREE.Vector3(p.x, p.y + 0.75, p.z);
  const close = new THREE.Vector3((p.x + p.anchor.x) / 2, (p.y + p.anchor.y) / 2, (p.z + p.anchor.z) / 2);
  // The hop runs along +x, so looking down -z is from its side.
  const side = shot([sideGround(D), ...parts], wide, 0, 0.06, 3.2);
  const park = shot([sideGround(D), ...parts], close, -0.6, 0.05, 0.62);
  const px = new Float32Array(W * 2 * H * 4);
  for (let y = 0; y < H; y++) {
    px.set(side.subarray(y * W * 4, (y + 1) * W * 4), y * W * 2 * 4);
    px.set(park.subarray(y * W * 4, (y + 1) * W * 4), (y * W * 2 + W) * 4);
  }
  writeFileSync(join(dir, `f${String(n).padStart(4, '0')}.png`), png(W * 2, H, px));
  n++;
}
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', join(dir, 'f%04d.png'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', out]);
console.log(`wrote ${out}: ${n} frames, ${(total / 1000).toFixed(1)} s, a ${D}-unit hop`);
