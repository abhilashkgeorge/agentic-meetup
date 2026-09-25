/**
 * A picture of every piece a person can wear, drawn once, shipped as one PNG.
 *
 *     node scripts/build-thumbs.mjs            # after build-characters.mjs
 *
 * WHY THIS EXISTS. The builder used to be a wall of words -- "Punk", "Overalls",
 * "Trouser suit" -- and nobody knows what "Overalls" looks like in this pack until
 * they tap it and look at their own character. A picker shows you the thing.
 *
 * WHY IT IS A BUILD STEP AND NOT A LITTLE 3D VIEW PER CHIP. Forty little GL canvases
 * on a phone is forty contexts, forty frame loops and forty copies of a 3.7 MB model.
 * These are forty pictures of things that never change, so they are drawn once here
 * and shipped as one sprite sheet the app crops with an offset. One decode, one
 * texture, no GL.
 *
 * WHY IT RASTERISES BY HAND. Rendering in Node needs a GL context, which means a
 * native module or a headless Chrome -- a hundred megabytes of build dependency to
 * draw forty 128-pixel squares of flat-shaded low-poly. The whole renderer below is a
 * z-buffer and a triangle loop, and the PNG writer is zlib plus four chunk headers.
 * Nothing is installed, and it runs in about a second.
 *
 * WHAT IT DRAWS. Each piece SKINNED INTO THE REST POSE, the same maths the phone does
 * -- `bone.matrixWorld * boneInverse * bindMatrix * v`, blended over its four joints.
 * Taking the raw vertices instead would be wrong by the gap between this pack's stored
 * pose and its bind pose, which is a whole eye's height (see `character-mesh.ts`).
 * Colours follow the app's rules: skin, hair and the top take the person's colours, so
 * they are drawn in the starter ones; everything else keeps what the artist chose.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(APP, 'assets', 'characters');

/** One tile. 128 is two of the 64-point chips the picker draws at, on a 2x screen. */
const TILE = 128;
const COLS = 8;
/** Room around the piece inside its tile, as a fraction. */
const PAD = 0.1;

/** The starter colours, so a thumbnail is a fair picture of what you would get. */
const SKIN = '#caa073';
const HAIR = '#1d1a1a';
const CLOTH = '#2e3f6e';

const SLOTS = ['head', 'top', 'legs', 'feet'];

/** Whose face the beard tiles are drawn on: the first men's set, as the app does. */
const FACE_FOR_BEARDS = 'm_casual_2';

// ── the model, skinned into the pose the phone shows ─────────────────────────

const manifest = JSON.parse(readFileSync(join(OUT, 'people.json'), 'utf8'));
const buf = readFileSync(join(OUT, 'people.glb'));
const gltf = await new Promise((res, rej) =>
  new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
gltf.scene.updateMatrixWorld(true);

const byName = new Map();
gltf.scene.traverse((o) => { if (o.isSkinnedMesh) byName.set(o.name, o); });

/**
 * A mesh's vertices where the renderer actually puts them.
 *
 * Skinning, by hand: every vertex is blended over the four bones that claim it, each
 * contributing `bone.matrixWorld * boneInverse` applied to the bound vertex. In this
 * pack the armature is STORED in a different pose from the one it was bound in, so
 * skipping this and reading POSITION straight out is off by 4 cm at the head.
 */
function skinned(mesh) {
  const { position, normal, skinIndex, skinWeight } = mesh.geometry.attributes;
  const bones = mesh.skeleton.bones;
  const inv = mesh.skeleton.boneInverses;
  const mats = bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, inv[i]));
  const bind = mesh.bindMatrix;
  const out = new Float32Array(position.count * 3);
  const nrm = new Float32Array(position.count * 3);
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  const acc = new THREE.Vector3(), accN = new THREE.Vector3();
  const tmp = new THREE.Vector3(), tmpN = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).applyMatrix4(bind);
    n.fromBufferAttribute(normal, i);
    acc.set(0, 0, 0); accN.set(0, 0, 0);
    let total = 0;
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(i, k);
      if (w <= 0) continue;
      const m = mats[skinIndex.getComponent(i, k)];
      if (!m) continue;
      tmp.copy(v).applyMatrix4(m).multiplyScalar(w);
      acc.add(tmp);
      tmpN.copy(n).transformDirection(m).multiplyScalar(w);
      accN.add(tmpN);
      total += w;
    }
    if (total === 0) { acc.copy(v); accN.copy(n); }
    out[i * 3] = acc.x; out[i * 3 + 1] = acc.y; out[i * 3 + 2] = acc.z;
    accN.normalize();
    nrm[i * 3] = accN.x; nrm[i * 3 + 1] = accN.y; nrm[i * 3 + 2] = accN.z;
  }
  return { pos: out, nrm, index: mesh.geometry.index };
}

/** glTF stores colour linear; the app shows it through an sRGB pipeline. */
const toSRGB = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const hexToRGB = (hex) => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

function colourOf(mesh, role) {
  if (role === 'skin') return hexToRGB(SKIN);
  if (role === 'hair') return hexToRGB(HAIR);
  if (role === 'top') return hexToRGB(CLOTH);
  const c = mesh.material?.color;
  return c ? [toSRGB(c.r), toSRGB(c.g), toSRGB(c.b)] : [0.6, 0.6, 0.6];
}

// ── the renderer: a z-buffer and a triangle loop ─────────────────────────────

/**
 * The app's two lights, as arithmetic.
 *
 * `hemisphereLight('#ffffff', '#8a94a6', 0.95)` plus a white directional at 0.8 from
 * the front-right-above, which is what `Figure` in canvas.tsx lights the preview with.
 * Matching it means a thumbnail and the character beside it are lit the same way.
 */
const SKY = [1, 1, 1];
const GROUND = [0x8a / 255, 0x94 / 255, 0xa6 / 255];
const KEY = new THREE.Vector3(3, 6, 4).normalize();

function shade(colour, nx, ny, nz) {
  const hemi = (ny + 1) / 2;
  const dir = Math.max(0, nx * KEY.x + ny * KEY.y + nz * KEY.z) * 0.8;
  return colour.map((c, i) => {
    const ambient = (SKY[i] * hemi + GROUND[i] * (1 - hemi)) * 0.95;
    return Math.min(1, c * (ambient + dir));
  });
}

/** Front on, turned a little, so a jacket reads as a jacket and not a flat shape. */
const VIEW = new THREE.Matrix4()
  .makeRotationY(-0.38)
  .premultiply(new THREE.Matrix4().makeRotationX(0.12));

function draw(parts) {
  const px = new Float32Array(TILE * TILE * 4);
  // Nearer is a BIGGER z here: the view looks down -z, so the buffer starts at
  // minus infinity and keeps the largest. Starting it at +Infinity rejects every
  // fragment and writes forty blank squares, which is exactly what it did.
  const zb = new Float32Array(TILE * TILE).fill(-Infinity);

  // Everything in view space first, so the fit is the fit of what is drawn.
  const seen = parts.map(({ geo, colour }) => {
    const p = new Float32Array(geo.pos.length);
    const n = new Float32Array(geo.nrm.length);
    const v = new THREE.Vector3();
    for (let i = 0; i < geo.pos.length; i += 3) {
      v.set(geo.pos[i], geo.pos[i + 1], geo.pos[i + 2]).applyMatrix4(VIEW);
      p[i] = v.x; p[i + 1] = v.y; p[i + 2] = v.z;
      v.set(geo.nrm[i], geo.nrm[i + 1], geo.nrm[i + 2]).transformDirection(VIEW);
      n[i] = v.x; n[i + 1] = v.y; n[i + 2] = v.z;
    }
    return { p, n, index: geo.index, colour };
  });

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of seen) {
    for (let i = 0; i < s.p.length; i += 3) {
      if (s.p[i] < minX) minX = s.p[i];
      if (s.p[i] > maxX) maxX = s.p[i];
      if (s.p[i + 1] < minY) minY = s.p[i + 1];
      if (s.p[i + 1] > maxY) maxY = s.p[i + 1];
    }
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const scale = (TILE * (1 - PAD * 2)) / span;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const toPx = (x, y) => [TILE / 2 + (x - cx) * scale, TILE / 2 - (y - cy) * scale];

  for (const s of seen) {
    const tri = s.index ? s.index.count : s.p.length / 3;
    for (let t = 0; t < tri; t += 3) {
      const a = s.index ? s.index.getX(t) : t;
      const b = s.index ? s.index.getX(t + 1) : t + 1;
      const c = s.index ? s.index.getX(t + 2) : t + 2;
      const [ax, ay] = toPx(s.p[a * 3], s.p[a * 3 + 1]);
      const [bx, by] = toPx(s.p[b * 3], s.p[b * 3 + 1]);
      const [cxp, cyp] = toPx(s.p[c * 3], s.p[c * 3 + 1]);
      const area = (bx - ax) * (cyp - ay) - (by - ay) * (cxp - ax);
      if (area === 0) continue;

      // Flat per triangle, which is how the art is modelled and how it is drawn.
      const nx = (s.n[a * 3] + s.n[b * 3] + s.n[c * 3]) / 3;
      const ny = (s.n[a * 3 + 1] + s.n[b * 3 + 1] + s.n[c * 3 + 1]) / 3;
      const nz = (s.n[a * 3 + 2] + s.n[b * 3 + 2] + s.n[c * 3 + 2]) / 3;
      const lit = shade(s.colour, nx, ny, nz);

      const lo = (v) => Math.max(0, Math.floor(v));
      const hi = (v) => Math.min(TILE - 1, Math.ceil(v));
      const x0 = lo(Math.min(ax, bx, cxp)), x1 = hi(Math.max(ax, bx, cxp));
      const y0 = lo(Math.min(ay, by, cyp)), y1 = hi(Math.max(ay, by, cyp));
      const az = s.p[a * 3 + 2], bz = s.p[b * 3 + 2], cz = s.p[c * 3 + 2];

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const sx = x + 0.5, sy = y + 0.5;
          let w0 = ((bx - ax) * (sy - ay) - (by - ay) * (sx - ax)) / area;
          let w1 = ((cxp - bx) * (sy - by) - (cyp - by) * (sx - bx)) / area;
          let w2 = 1 - w0 - w1;
          // Barycentric, in the order (c, a, b) -- w0 is the weight of c.
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w1 * az + w2 * bz + w0 * cz;
          const at = y * TILE + x;
          if (z <= zb[at]) continue;              // nearer is bigger z, looking down -z
          zb[at] = z;
          px[at * 4] = lit[0]; px[at * 4 + 1] = lit[1]; px[at * 4 + 2] = lit[2]; px[at * 4 + 3] = 1;
        }
      }
    }
  }
  return px;
}

// ── PNG, by hand ─────────────────────────────────────────────────────────────

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (b) => {
    let c = -1;
    for (const x of b) c = t[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(Buffer.concat([Buffer.from(type, 'ascii'), body])), 0);
  return Buffer.concat([head, body, crc]);
}

function png(width, height, rgba) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;                 // filter: none
    for (let x = 0; x < width * 4; x++) {
      raw[y * (width * 4 + 1) + 1 + x] = Math.round(rgba[(y * width * 4) + x] * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── draw every piece ─────────────────────────────────────────────────────────

const keys = Object.keys(manifest.looks);
const tiles = [];
const index = {};

for (const key of keys) {
  for (const slot of SLOTS) {
    const parts = [];
    for (const piece of manifest.looks[key][slot]) {
      const mesh = byName.get(piece.mesh);
      if (!mesh) throw new Error(`${piece.mesh} is in the manifest but not the model`);
      parts.push({ geo: skinned(mesh), colour: colourOf(mesh, piece.role) });
    }
    index[`${key}:${slot}`] = tiles.length;
    tiles.push(draw(parts));
  }
}

// Bald is a head too, and the only one that is not a set: it borrows a face and drops
// the hair, which is exactly what `partsOf` draws for it. One per set, because WHOSE
// face it borrows depends on the person -- a woman wearing a man's bald head gets his
// jaw shading, which reads as a beard.
for (const key of keys) {
  const parts = manifest.looks[key].head
    .filter((piece) => piece.role !== 'hair')
    .map((piece) => ({ geo: skinned(byName.get(piece.mesh)), colour: colourOf(byName.get(piece.mesh), piece.role) }));
  index[`${key}:bald`] = tiles.length;
  tiles.push(draw(parts));
}

// Facial hair, drawn ON a face -- a beard alone in a circle is an unreadable smudge.
// The face is the men's first set with its hair off, which is whose face a beard goes
// on; the hair itself takes the starter hair colour, like the app tints it.
{
  const base = manifest.looks[FACE_FOR_BEARDS].head
    .filter((piece) => piece.role !== 'hair')
    .map((piece) => ({ geo: skinned(byName.get(piece.mesh)), colour: colourOf(byName.get(piece.mesh), piece.role) }));
  for (const name of manifest.beards ?? []) {
    const mesh = byName.get(name);
    if (!mesh) throw new Error(`${name} is in the manifest but not the model`);
    index[`beard:${name}`] = tiles.length;
    tiles.push(draw([...base, { geo: skinned(mesh), colour: hexToRGB(HAIR) }]));
  }
}

const rows = Math.ceil(tiles.length / COLS);
const sheetW = COLS * TILE, sheetH = rows * TILE;
const sheet = new Float32Array(sheetW * sheetH * 4);
tiles.forEach((tile, i) => {
  const ox = (i % COLS) * TILE, oy = Math.floor(i / COLS) * TILE;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const from = (y * TILE + x) * 4, to = ((oy + y) * sheetW + ox + x) * 4;
      for (let k = 0; k < 4; k++) sheet[to + k] = tile[from + k];
    }
  }
});

const file = png(sheetW, sheetH, sheet);
writeFileSync(join(OUT, 'thumbs.png'), file);

manifest.thumbs = { tile: TILE, cols: COLS, rows, index };
writeFileSync(join(OUT, 'people.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`thumbs.png  ${sheetW}x${sheetH}  ${tiles.length} tiles  ${(file.length / 1024).toFixed(0)} KB`);
