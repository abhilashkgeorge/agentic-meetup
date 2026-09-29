/**
 * The characters, drawn in Node with no GL: a z-buffer, flat shading and a PNG writer.
 *
 * Shared by the two scripts that draw people offline -- build-thumbs.mts (the builder's
 * pictures of every piece) and render-looks.mts (contact sheets of every pairing, to
 * check by eye that nothing pokes through). Both dress people with the app's own
 * `partsOf`, so what is drawn here is what the phone draws.
 *
 * WHY BY HAND. Rendering in Node needs a GL context, which means a native module or a
 * headless Chrome -- a hundred megabytes of build dependency to draw 128-pixel squares
 * of flat-shaded low-poly. This is a triangle loop, and the PNG is zlib plus four chunk
 * headers.
 *
 * SKINNED, NOT RAW. Every vertex is blended over its four bones the way the phone does
 * it (`bone.matrixWorld * boneInverse * bindMatrix * v`); reading POSITION straight out
 * is wrong by the gap between the pose this pack is stored in and the one it was bound
 * in, which is a whole eye's height at the head (character-mesh.ts). The accessories
 * are placed in their bone's bind space, so they go where that bone is now.
 */
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Look } from '@clone/shared';
import { LOOKS, SKULL_MIDDLE, buildScale, partsOf, underHat, type LookKey, type LookPieces, type Part } from '../src/features/world/character';
import { buildBag, buildExtras, clothOf, type BagKind, type Bone, type Manifest } from '../src/features/world/character-mesh';
import { sitPose } from '../src/features/world/crowd-gpu';

export const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ASSETS = join(APP, 'assets', 'characters');

export type RGB = [number, number, number];
export interface Drawn { pos: Float32Array; nrm: Float32Array; index: ArrayLike<number>; rgb: RGB }

export const toSRGB = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
export const hex = (h: string): RGB =>
  [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

// ── the model ────────────────────────────────────────────────────────────────

export interface People {
  manifest: Manifest;
  byName: Map<string, THREE.SkinnedMesh>;
  bones: Record<Bone, THREE.Bone>;
  pieces: (k: LookKey) => LookPieces | undefined;
  beards: readonly string[];
  extras: ReturnType<typeof buildExtras>;
  /** A bag made for one top (buildBag), in the chest bone's bind space. */
  bag: (kind: BagKind, topSet: number) => THREE.BufferGeometry | null;
}

/**
 * Read people.glb. `idle` poses it as the builder shows people (the idle clip half a
 * second in); `stored` leaves it in the pose the file keeps, arms down and apart,
 * which is how the builder's pictures of single pieces have always been drawn.
 */
export async function loadPeople(pose: 'idle' | 'stored' | 'sit'): Promise<People> {
  const manifest = JSON.parse(readFileSync(join(ASSETS, 'people.json'), 'utf8')) as Manifest;
  const buf = readFileSync(join(ASSETS, 'people.glb'));
  const gltf = await new Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>((res, rej) =>
    new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '', res as never, rej));
  if (pose === 'idle' || pose === 'sit') {
    const mixer = new THREE.AnimationMixer(gltf.scene);
    mixer.clipAction(gltf.animations.find((c) => c.name === 'idle')!).play();
    mixer.setTime(pose === 'sit' ? 0 : 0.5);
  }
  gltf.scene.updateMatrixWorld(true);
  if (pose === 'sit') {
    const bones = new Map<string, THREE.Bone>();
    gltf.scene.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone); });
    sitPose(gltf.scene, (n) => bones.get(n)!);
  }
  const byName = new Map<string, THREE.SkinnedMesh>();
  gltf.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) byName.set(o.name, o as THREE.SkinnedMesh); });
  const any = byName.values().next().value as THREE.SkinnedMesh;
  const bone = (name: Bone) => {
    const b = any.skeleton.bones.find((x) => x.name === name);
    if (!b) throw new Error(`the rig has no ${name} bone`);
    return b;
  };
  const toChest = any.skeleton.boneInverses[any.skeleton.bones.findIndex((b) => b.name === 'Chest')]!;
  const bags = new Map<string, THREE.BufferGeometry | null>();
  return {
    manifest,
    byName,
    bones: { Head: bone('Head'), Neck: bone('Neck'), Chest: bone('Chest') },
    pieces: (k) => manifest.looks[k],
    beards: manifest.beards ?? [],
    extras: buildExtras(),
    bag: (kind, set) => {
      const key = `${kind}:${set}`;
      if (!bags.has(key)) {
        const body = clothOf((manifest.looks[LOOKS[set]!]?.top ?? []).map((p) => {
          const m = byName.get(p.mesh)!;
          return { geometry: m.geometry, matrix: new THREE.Matrix4().multiplyMatrices(toChest, m.bindMatrix) };
        }));
        bags.set(key, buildBag(kind, body));
      }
      return bags.get(key)!;
    },
  };
}

const MIDDLE = new THREE.Vector3(...SKULL_MIDDLE);

/**
 * A mesh's vertices where the phone puts them, broadened by the person's build, and
 * grown about the middle of the skull by `fit` (a hairstyle on a bigger skull).
 */
function skinned(mesh: THREE.SkinnedMesh, bx: number, bz: number, fit = 1, hat = 0): { pos: Float32Array; nrm: Float32Array } {
  const { position, normal, skinIndex, skinWeight } = mesh.geometry.attributes as Record<string, THREE.BufferAttribute>;
  const mats = mesh.skeleton.bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, mesh.skeleton.boneInverses[i]!));
  const pos = new Float32Array(position!.count * 3);
  const nrm = new Float32Array(position!.count * 3);
  const v = new THREE.Vector3(), n = new THREE.Vector3(), acc = new THREE.Vector3(), accN = new THREE.Vector3(), t = new THREE.Vector3();
  for (let i = 0; i < position!.count; i++) {
    v.fromBufferAttribute(position!, i).applyMatrix4(mesh.bindMatrix);
    if (fit !== 1) v.sub(MIDDLE).multiplyScalar(fit).add(MIDDLE);
    const under = hat ? underHat(v.x, v.y, v.z, hat) : null;
    if (under) v.set(...under);
    n.fromBufferAttribute(normal!, i);
    acc.set(0, 0, 0); accN.set(0, 0, 0);
    let total = 0;
    for (let k = 0; k < 4; k++) {
      const w = skinWeight!.getComponent(i, k);
      if (w <= 0) continue;
      const m = mats[skinIndex!.getComponent(i, k)];
      if (!m) continue;
      acc.add(t.copy(v).applyMatrix4(m).multiplyScalar(w));
      accN.add(t.copy(n).transformDirection(m).multiplyScalar(w));
      total += w;
    }
    if (total === 0) { acc.copy(v); accN.copy(n); }
    accN.normalize();
    pos.set([acc.x * bx, acc.y, acc.z * bz], i * 3);
    nrm.set([accN.x, accN.y, accN.z], i * 3);
  }
  return { pos, nrm };
}

/** Which of a look's things to draw: a mesh by what it answers to, an extra by kind. */
export type Keep = (thing: { worn: Part['worn'] | 'extra' }) => boolean;

/** Everything a look wears, as triangles with a colour each. */
export function dressed(people: People, look: Look, keep: Keep = () => true): Drawn[] {
  const [bx, , bz] = buildScale(look);
  const who = partsOf(look, people.pieces, people.beards);
  const out: Drawn[] = [];
  for (const part of who.parts) {
    if (!keep({ worn: part.worn })) continue;
    const mesh = people.byName.get(part.mesh);
    if (!mesh) throw new Error(`${part.mesh} is not in the model`);
    const c = (mesh.material as THREE.MeshStandardMaterial).color;
    const rgb: RGB = part.tint ? hex(part.tint) : [toSRGB(c.r), toSRGB(c.g), toSRGB(c.b)];
    // Hair under a hat is drawn pulled in under it, as the GPU crowd draws it.
    out.push({ ...skinned(mesh, bx, bz, part.fit, part.worn === 'hair' ? look.hat : 0), index: mesh.geometry.index!.array, rgb });
  }
  if (!keep({ worn: 'extra' })) return out;
  for (const e of who.extras) {
    const { geometry: g, bone } = e.kind === 'backpack' || e.kind === 'shoulderbag'
      ? { geometry: people.bag(e.kind, LOOKS.indexOf(who.wearing.top)), bone: 'Chest' as const }
      : people.extras[e.kind];
    if (!g) continue;
    // Placed in the bone's bind space, weighted wholly to it: skinning reduces to the
    // bone's own world matrix.
    const m = people.bones[bone].matrixWorld;
    const p = g.attributes.position as THREE.BufferAttribute;
    const nn = g.attributes.normal as THREE.BufferAttribute;
    const pos = new Float32Array(p.count * 3), nrm = new Float32Array(p.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      pos.set([v.x * bx, v.y, v.z * bz], i * 3);
      v.fromBufferAttribute(nn, i).transformDirection(m);
      nrm.set([v.x, v.y, v.z], i * 3);
    }
    const index = g.index ? g.index.array : Uint32Array.from({ length: p.count }, (_, i) => i);
    out.push({ pos, nrm, index, rgb: hex(e.tint) });
  }
  return out;
}

// ── the rasteriser ───────────────────────────────────────────────────────────

/** The builder's studio light (character-canvas.tsx): white sky, warm bounce, a key. */
const SKY = [1, 1, 1], GROUND = hex('#c9bfb4');
const KEY = new THREE.Vector3(2.5, 4, 5).normalize();
function shade(c: readonly number[], nx: number, ny: number, nz: number): number[] {
  const hemi = (ny + 1) / 2;
  const dir = Math.max(0, nx * KEY.x + ny * KEY.y + nz * KEY.z) * 0.66;
  return c.map((v, i) => Math.min(1, v * ((SKY[i]! * hemi + GROUND[i]! * (1 - hemi)) * 0.62 + dir)));
}

/** Turned a little, so a jacket reads as a jacket; `yaw` more to see a side or the back. */
export const view = (yaw = -0.35, pitch = 0.06) =>
  new THREE.Matrix4().makeRotationY(yaw).premultiply(new THREE.Matrix4().makeRotationX(pitch));

export interface Frame {
  /** What to fit: a band of model height, centred; or everything drawn, padded. */
  fit: { band: [number, number] } | { pad: number };
  view?: THREE.Matrix4;
  /** Behind the figure; transparent when absent. */
  background?: RGB;
  /** Only triangles whose middle is at this model height (after posing). */
  clipY?: [number, number];
}

export function draw(parts: Drawn[], w: number, h: number, frame: Frame): Float32Array {
  const px = new Float32Array(w * h * 4);
  if (frame.background) {
    for (let i = 0; i < w * h; i++) px.set([...frame.background, 1], i * 4);
  }
  const zb = new Float32Array(w * h).fill(-Infinity);
  const V = frame.view ?? view();
  const v = new THREE.Vector3();
  // Everything in view space first, so a fit is the fit of what is drawn.
  const seen = parts.map((part) => {
    const p = new Float32Array(part.pos.length), n = new Float32Array(part.nrm.length);
    for (let i = 0; i < p.length; i += 3) {
      v.set(part.pos[i]!, part.pos[i + 1]!, part.pos[i + 2]!).applyMatrix4(V);
      p[i] = v.x; p[i + 1] = v.y; p[i + 2] = v.z;
      v.set(part.nrm[i]!, part.nrm[i + 1]!, part.nrm[i + 2]!).transformDirection(V);
      n[i] = v.x; n[i + 1] = v.y; n[i + 2] = v.z;
    }
    const tris: number[] = [];
    for (let t = 0; t < part.index.length; t += 3) {
      const a = part.index[t]!, b = part.index[t + 1]!, c = part.index[t + 2]!;
      if (frame.clipY) {
        const y = (part.pos[a * 3 + 1]! + part.pos[b * 3 + 1]! + part.pos[c * 3 + 1]!) / 3;
        if (y < frame.clipY[0] || y > frame.clipY[1]) continue;
      }
      tris.push(a, b, c);
    }
    return { p, n, tris, rgb: part.rgb };
  });

  let toPx: (x: number, y: number) => readonly [number, number];
  if ('band' in frame.fit) {
    const [y0, y1] = frame.fit.band;
    const scale = (h * 0.96) / (y1 - y0);
    toPx = (x, y) => [w / 2 + x * scale, h * 0.02 + (y1 - y) * scale];
  } else {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const s of seen) {
      for (const i of s.tris) {
        const x = s.p[i * 3]!, y = s.p[i * 3 + 1]!;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const scale = (Math.min(w, h) * (1 - frame.fit.pad * 2)) / span;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    toPx = (x, y) => [w / 2 + (x - cx) * scale, h / 2 - (y - cy) * scale];
  }

  for (const s of seen) {
    const { p, n } = s;
    for (let t = 0; t < s.tris.length; t += 3) {
      const a = s.tris[t]!, b = s.tris[t + 1]!, c = s.tris[t + 2]!;
      const [ax, ay] = toPx(p[a * 3]!, p[a * 3 + 1]!);
      const [bx, by] = toPx(p[b * 3]!, p[b * 3 + 1]!);
      const [cx, cy] = toPx(p[c * 3]!, p[c * 3 + 1]!);
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (area === 0) continue;
      // Flat per triangle, which is how the art is modelled and how it is drawn.
      const lit = shade(s.rgb, (n[a * 3]! + n[b * 3]! + n[c * 3]!) / 3, (n[a * 3 + 1]! + n[b * 3 + 1]! + n[c * 3 + 1]!) / 3,
        (n[a * 3 + 2]! + n[b * 3 + 2]! + n[c * 3 + 2]!) / 3);
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
      const yy0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), yy1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
      const az = p[a * 3 + 2]!, bz = p[b * 3 + 2]!, cz = p[c * 3 + 2]!;
      for (let y = yy0; y <= yy1; y++) {
        for (let x = x0; x <= x1; x++) {
          const sx = x + 0.5, sy = y + 0.5;
          const w0 = ((bx - ax) * (sy - ay) - (by - ay) * (sx - ax)) / area;
          const w1 = ((cx - bx) * (sy - by) - (cy - by) * (sx - bx)) / area;
          const w2 = 1 - w0 - w1;
          // Barycentric, in the order (c, a, b): w0 is the weight of c.
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          // Nearer is a BIGGER z: the view looks down -z.
          const z = w1 * az + w2 * bz + w0 * cz;
          const at = y * w + x;
          if (z <= zb[at]!) continue;
          zb[at] = z;
          px[at * 4] = lit[0]!; px[at * 4 + 1] = lit[1]!; px[at * 4 + 2] = lit[2]!; px[at * 4 + 3] = 1;
        }
      }
    }
  }
  return px;
}

// ── PNG ──────────────────────────────────────────────────────────────────────

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return (b: Buffer) => { let c = -1; for (const x of b) c = t[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();
function chunk(type: string, body: Buffer) {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(Buffer.concat([Buffer.from(type, 'ascii'), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** 8-bit RGBA, from floats 0..1. */
export function png(width: number, height: number, rgba: Float32Array): Buffer {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;                 // filter: none
    for (let x = 0; x < width * 4; x++) raw[y * (width * 4 + 1) + 1 + x] = Math.round(rgba[y * width * 4 + x]! * 255);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Tiles into one sheet, row by row. */
export function sheetOf(tiles: Float32Array[], cols: number, tw: number, th: number, rule = false): { w: number; h: number; px: Float32Array } {
  const rows = Math.ceil(tiles.length / cols);
  const w = cols * tw, h = rows * th;
  const px = new Float32Array(w * h * 4);
  tiles.forEach((tile, i) => {
    const ox = (i % cols) * tw, oy = Math.floor(i / cols) * th;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const from = (y * tw + x) * 4, to = ((oy + y) * w + ox + x) * 4;
      // A hairline between tiles, so a gap in a body is not mistaken for the next tile.
      const edge = rule && (x === tw - 1 || y === th - 1);
      for (let k = 0; k < 4; k++) px[to + k] = edge ? (k === 3 ? 1 : 0.7) : tile[from + k]!;
    }
  });
  return { w, h, px };
}
