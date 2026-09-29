/**
 * The park's fence: an iron railing all the way round its outline, stone pillars along
 * it, and a gate -- two tall pillars -- wherever a path meets it.
 *
 * WHAT THE FOUNDER ASKED (2026-09-29): "make sure the park has a see through barricade
 * around the park so that users can know what the end of the park is in all
 * directions". So you can see through it -- it is bars, not a wall -- and it stands
 * exactly where the park stops you (MapSpots.bounds is the same outline).
 *
 * THE BARS ARE A TEXTURE, NOT GEOMETRY. Seven hundred units of railing at a bar every
 * fourteen centimetres is forty thousand bars; drawn as a picture of bars on one strip
 * per edge, with the gaps cut out (alphaTest), it is 138 triangles. Far off, the bars
 * blur together below the cut and the railing fades out, which the mist does anyway.
 *
 * Reached only through garden-mesh.ts (it imports three).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Pt } from './sim';

const M = 1 / 8.1;
/** The railing's height: 1.55 m, below a person's shoulder, so the city shows over it. */
export const FENCE_H = 1.55 * M;
/** One tile of the railing's picture along the fence: eight bars, 14 cm apart. */
export const FENCE_TILE = 8 * 0.14 * M;
/** A stone pillar every 18 m, 36 cm square and 1.75 m tall; a gate's are 2.8 m. */
const PILLAR_EVERY = 18 * M;
const PILLAR = { w: 0.36 * M, h: 1.75 * M };
const GATE = { w: 0.5 * M, h: 2.8 * M };

export interface Gate { x: number; z: number; rot: number; width: number }

/**
 * The railing's picture: iron bars with spear tips between two rails, and nothing in
 * between -- alpha 0, cut out by the material. Rows run from the ground up.
 */
export function railingTexture(): THREE.DataTexture {
  const W = 64, H = 32;
  const data = new Uint8Array(W * H * 4);
  const set = (x: number, y: number) => { const i = (y * W + x) * 4; data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 255; };
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      const bar = x % 8 < 2 && y < 29;
      const tip = x % 8 === 0 && y >= 29;          // the spear, a pixel wide, above the top rail
      const rail = (y >= 3 && y <= 4) || (y >= 25 && y <= 26);
      if (bar || tip || rail) set(x, y);
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** The railing: one upright strip per edge of the outline, its picture counted along it. */
export function railingGeometry(outline: readonly Pt[]): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let run = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!, b = outline[(i + 1) % outline.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const at = pos.length / 3;
    const u0 = run / FENCE_TILE, u1 = (run + len) / FENCE_TILE;
    pos.push(a[0], 0, a[1], b[0], 0, b[1], b[0], FENCE_H, b[1], a[0], FENCE_H, a[1]);
    uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
    idx.push(at, at + 1, at + 2, at, at + 2, at + 3);
    run += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Where the pillars stand: every PILLAR_EVERY along the fence, and at every sharp turn. */
export function pillarSpots(outline: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  let next = 0, run = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!, b = outline[(i + 1) % outline.length]!;
    const prev = outline[(i - 1 + outline.length) % outline.length]!;
    const turn = Math.abs(Math.atan2(Math.sin(Math.atan2(b[0] - a[0], b[1] - a[1]) - Math.atan2(a[0] - prev[0], a[1] - prev[1])),
      Math.cos(Math.atan2(b[0] - a[0], b[1] - a[1]) - Math.atan2(a[0] - prev[0], a[1] - prev[1]))));
    if (turn > 0.5) { out.push([a[0], a[1]]); next = run + PILLAR_EVERY; }
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (next < run + len) {
      const t = (next - run) / len;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      next += PILLAR_EVERY;
    }
    run += len;
  }
  return out;
}

export interface BuiltFence { meshes: THREE.Mesh[]; dispose(): void }

export function buildFence(outline: readonly Pt[], gates: readonly Gate[], colors: { night: boolean }): BuiltFence {
  const tex = railingTexture();
  const iron = new THREE.MeshLambertMaterial({
    color: colors.night ? '#1d2620' : '#2F3D33', map: tex, alphaTest: 0.5, side: THREE.DoubleSide,
  });
  const railing = new THREE.Mesh(railingGeometry(outline), iron);
  railing.name = 'fence';
  railing.frustumCulled = false;
  railing.raycast = () => {};

  // Pillars and gate posts: boxes with a cap, merged into one mesh of stone.
  const parts: THREE.BufferGeometry[] = [];
  const post = (p: Pt, w: number, h: number, rot: number) => {
    const body = new THREE.BoxGeometry(w, h, w).translate(0, h / 2, 0);
    const cap = new THREE.BoxGeometry(w * 1.3, w * 0.35, w * 1.3).translate(0, h + w * 0.17, 0);
    for (const g of [body, cap]) { g.deleteAttribute('uv'); g.rotateY(rot); g.translate(p[0], 0, p[1]); parts.push(g); }
  };
  for (const p of pillarSpots(outline)) post(p, PILLAR.w, PILLAR.h, 0);
  for (const g of gates) {
    const along: Pt = [Math.sin(g.rot), Math.cos(g.rot)];
    for (const side of [-1, 1]) {
      post([g.x + along[0] * (g.width / 2 + GATE.w) * side, g.z + along[1] * (g.width / 2 + GATE.w) * side], GATE.w, GATE.h, g.rot);
    }
  }
  const stone = new THREE.MeshLambertMaterial({ color: colors.night ? '#6d665a' : '#D8CDB4' });
  const merged = parts.length ? mergeGeometries(parts, false)! : new THREE.BufferGeometry();
  for (const p of parts) p.dispose();
  const pillars = new THREE.Mesh(merged, stone);
  pillars.name = 'fence-pillars';
  pillars.frustumCulled = false;
  pillars.raycast = () => {};

  return {
    meshes: [railing, pillars],
    dispose() {
      railing.geometry.dispose(); pillars.geometry.dispose();
      iron.dispose(); stone.dispose(); tex.dispose();
    },
  };
}
