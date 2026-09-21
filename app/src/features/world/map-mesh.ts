/**
 * The miniature Bengaluru, drawn.
 *
 * Reached only from ./canvas.tsx (tests/native-imports.test.ts lists both as the files
 * allowed to import three). Everything is built once from the map asset and merged
 * into THIRTEEN meshes -- one draw call each -- so the frame loop has nothing to do
 * but breathe the water:
 *
 *   plate · skirt · tiles · your tile · roads · water · parks · trees · blocks ·
 *   landmarks · lamp posts · bulbs · windows (dark theme only; count 0 in light)
 *
 * The look is the app's own rule from components/ui/theme.ts: one colour, and depth
 * by a soft bevel and a shadow to the bottom-right, never a differently filled box.
 * Tiles are the page colour extruded with a bevel; the skirt is every tile flat in the
 * shadow grey, offset so it shows to the bottom-right; roads are the highlight white
 * drawn as ribbons; lakes and parks are faint tints. The tile top is y = 0, which is
 * where the people stand, so nothing in canvas.tsx moved when the square became a
 * city. Budget: 32 K triangles in either theme (tests/map-mesh.test.ts holds the line
 * at 60 K and thirteen draw calls), on top of the town's forty calls at worst.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapAreaAsset, MapAsset } from './map';
import type { Pt } from './sim';

export interface MapColors {
  /** The page colour: tiles. */
  bg: string;
  /** The sunken grey: the plate under the tiles, the lakes' base. */
  ground: string;
  /** The highlight: roads, blocks. */
  light: string;
  /** The shadow grey: the skirt, landmarks, lamp posts. */
  prop: string;
  accent: string;
  success: string;
  warning: string;
  /** Evening: lamps and windows lit, water glowing a little. */
  night: boolean;
}

export interface BuiltMap {
  group: THREE.Group;
  /** Breathe on this in the frame loop: opacity and, at night, emissiveIntensity. */
  water: THREE.MeshLambertMaterial;
  bulbs: THREE.MeshLambertMaterial;
  /** Lift one tile toward the accent; null puts it back. Rebuilds two meshes, rarely. */
  setYourTile(id: string | null): void;
  /** For the budget test: triangles counted from the geometries, instances included. */
  stats(): { meshes: number; triangles: number };
  dispose(): void;
}

/** Tile top is y = 0; the body hangs below it, the plate further down. */
const TILE_DEPTH = 0.22;
const BEVEL = 0.08;
const PLATE_Y = -(TILE_DEPTH + BEVEL * 2) - 0.04;
const SKIRT_Y = PLATE_Y + 0.012;
const SKIRT_OFFSET = 0.3;
const ROAD_Y = 0.012;
const FLAT_Y = 0.008;
const ROAD_WIDTH: Record<string, number> = { trunk: 0.22, primary: 0.16, secondary: 0.11 };
const MAX_WINDOWS = 900;

const mix = (a: string, b: string, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t);
const lambert = (color: THREE.Color | string, extra: THREE.MeshLambertMaterialParameters = {}) =>
  new THREE.MeshLambertMaterial({ color, ...extra });

/** A ring in x/z as a three Shape. The y flip pairs with the -90° X rotation below. */
function shapeOf(ring: readonly Pt[]): THREE.Shape {
  return new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
}

/** Lay a shape-space geometry flat on the ground: shape x stays x, shape y becomes z. */
function flatten(g: THREE.BufferGeometry, y: number, dx = 0, dz = 0): THREE.BufferGeometry {
  g.rotateX(-Math.PI / 2);
  g.translate(dx, y, dz);
  return g;
}

function flatRings(rings: readonly (readonly Pt[])[], y: number, dx = 0, dz = 0): THREE.BufferGeometry | null {
  const parts = rings.filter((r) => r.length >= 3).map((r) => flatten(new THREE.ShapeGeometry(shapeOf(r)), y, dx, dz));
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

/** One tile: extruded with a bevel, its top face at y = 0. */
function tileGeometry(a: MapAreaAsset): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shapeOf(a.polygon), {
    depth: TILE_DEPTH, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 2, curveSegments: 1,
  });
  // Extruded along +z of shape space from -bevel to depth+bevel; flatten puts that on y.
  return flatten(g, -(TILE_DEPTH + BEVEL));
}

/**
 * Roads as ribbons: two vertices per polyline point, offset along the local normal,
 * quads between. Sharp corners pinch a little at 0.16 wide, which nobody sees at
 * the town's zoom.
 */
function ribbons(roads: Record<string, Pt[][]>): THREE.BufferGeometry {
  let verts = 0; let quads = 0;
  for (const [cls, lines] of Object.entries(roads)) {
    if (!(cls in ROAD_WIDTH)) continue;
    for (const l of lines) { if (l.length >= 2) { verts += l.length * 2; quads += l.length - 1; } }
  }
  const pos = new Float32Array(verts * 3);
  const nrm = new Float32Array(verts * 3);
  const idx = new Uint32Array(quads * 6);
  let v = 0; let q = 0;
  for (const [cls, lines] of Object.entries(roads)) {
    const w = ROAD_WIDTH[cls];
    if (w === undefined) continue;
    for (const l of lines) {
      if (l.length < 2) continue;
      const base = v;
      for (let i = 0; i < l.length; i++) {
        const p = l[i]!; const prev = l[Math.max(0, i - 1)]!; const next = l[Math.min(l.length - 1, i + 1)]!;
        let dx = next[0] - prev[0]; let dz = next[1] - prev[1];
        const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
        const nx = -dz * w * 0.5; const nz = dx * w * 0.5;
        pos.set([p[0] + nx, ROAD_Y, p[1] + nz, p[0] - nx, ROAD_Y, p[1] - nz], v * 3);
        nrm.set([0, 1, 0, 0, 1, 0], v * 3);
        v += 2;
      }
      for (let i = 0; i < l.length - 1; i++) {
        const a = base + i * 2;
        idx.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], q * 6);
        q++;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// ── landmarks: eight icons from primitives, ≤ 250 triangles each ────────────

type Prim = { g: THREE.BufferGeometry; x?: number; y?: number; z?: number; ry?: number; rx?: number; rz?: number };
const box = (w: number, h: number, d: number, x = 0, y = h / 2, z = 0, ry = 0): Prim => ({ g: new THREE.BoxGeometry(w, h, d), x, y, z, ry });
const cyl = (rt: number, rb: number, h: number, x = 0, y = h / 2, z = 0, seg = 8): Prim => ({ g: new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z });
const ball = (r: number, x = 0, y = r, z = 0): Prim => ({ g: new THREE.SphereGeometry(r, 8, 6), x, y, z });
const cone = (r: number, h: number, x = 0, y = h / 2, z = 0, seg = 6): Prim => ({ g: new THREE.ConeGeometry(r, h, seg), x, y, z });

function landmark(kind: string): Prim[] {
  switch (kind) {
    case 'dome': return [box(1.6, 0.45, 0.9), box(0.6, 0.25, 0.6, 0, 0.57), cyl(0.28, 0.28, 0.2, 0, 0.8), ball(0.3, 0, 1.05)];
    case 'tower': return [box(0.55, 1.6, 0.55), box(0.38, 0.3, 0.38, 0, 1.75), box(0.5, 0.35, 0.5, 0.6, 0.175, 0.2)];
    case 'palace': return [
      box(1.5, 0.5, 0.7), ...[[-0.65, -0.25], [0.65, -0.25], [-0.65, 0.25], [0.65, 0.25]].flatMap(([x, z]) =>
        [cyl(0.11, 0.11, 0.75, x, 0.375, z, 6), cone(0.14, 0.2, x, 0.85, z)]),
    ];
    case 'temple': return [box(0.9, 0.35, 0.9), cone(0.42, 0.85, 0, 0.77, 0, 4), ball(0.08, 0, 1.28)];
    case 'glasshouse': return [box(1.1, 0.35, 0.6), { g: new THREE.CylinderGeometry(0.3, 0.3, 1.1, 10, 1, false, 0, Math.PI), x: 0, y: 0.35, z: 0, rz: Math.PI / 2 }];
    case 'stadium': return [{ g: new THREE.TorusGeometry(0.75, 0.2, 6, 18), x: 0, y: 0.2, z: 0, rx: -Math.PI / 2 }, cyl(0.55, 0.55, 0.05, 0, 0.025, 0, 18)];
    case 'fort': return [
      box(1.2, 0.4, 1.2), ...[[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]].map(([x, z]) => cyl(0.17, 0.17, 0.62, x, 0.31, z, 6)),
    ];
    case 'bull': return [box(1.0, 0.15, 1.2), box(0.5, 0.32, 0.85, 0, 0.31), ball(0.19, 0, 0.5, 0.5)];
    default: return [box(0.6, 0.6, 0.6)];
  }
}

function landmarksGeometry(map: MapAsset): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const l of map.landmarks) {
    for (const p of landmark(l.kind)) {
      const g = p.g;
      if (p.rx) g.rotateX(p.rx);
      if (p.rz) g.rotateZ(p.rz);
      if (p.ry) g.rotateY(p.ry);
      g.translate(p.x ?? 0, p.y ?? 0, p.z ?? 0);
      g.rotateY(l.rot);
      g.translate(l.at[0], 0, l.at[1]);
      // BoxGeometry carries no uv2 but a merge wants the same attribute set everywhere.
      g.deleteAttribute('uv');
      parts.push(g);
    }
  }
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

// ── the build ────────────────────────────────────────────────────────────────

const triangles = (g: THREE.BufferGeometry) => (g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0)) / 3;

export function buildMap(map: MapAsset, colors: MapColors): BuiltMap {
  const group = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  const disposables: { dispose(): void }[] = [];
  const add = (geometry: THREE.BufferGeometry | null, material: THREE.Material, name: string): THREE.Mesh | null => {
    if (!geometry) { material.dispose(); return null; }
    const m = new THREE.Mesh(geometry, material);
    m.name = name;
    m.frustumCulled = false;
    group.add(m); meshes.push(m); disposables.push(geometry, material);
    return m;
  };
  const dummy = new THREE.Object3D();
  const night = colors.night;

  // Plate: the sunken grey under everything, larger than the outline.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of map.outline) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const plate = new THREE.PlaneGeometry(maxX - minX + 40, maxZ - minZ + 40);
  flatten(plate, PLATE_Y, (minX + maxX) / 2, (minZ + maxZ) / 2);
  add(plate, lambert(colors.ground), 'plate');

  // Skirt: every tile flat in the shadow grey, offset to the bottom-right.
  add(flatRings(map.areas.map((a) => a.polygon), SKIRT_Y, SKIRT_OFFSET, SKIRT_OFFSET),
    lambert(colors.prop, { transparent: true, opacity: 0.3, depthWrite: false }), 'skirt');

  // Tiles, and your tile: the same extrusion, one of them lifted toward the accent.
  const tileMaterial = lambert(colors.bg);
  const yoursMaterial = lambert(mix(colors.bg, colors.accent, 0.25));
  const tiles = new THREE.Mesh(new THREE.BufferGeometry(), tileMaterial);
  const yours = new THREE.Mesh(new THREE.BufferGeometry(), yoursMaterial);
  for (const m of [tiles, yours]) { m.frustumCulled = false; group.add(m); meshes.push(m); }
  disposables.push(tileMaterial, yoursMaterial);
  tiles.name = 'tiles'; yours.name = 'yours';
  let yourId: string | null = null;
  const setYourTile = (id: string | null) => {
    if (id === yourId && tiles.geometry.getAttribute('position')) return;
    yourId = map.areas.some((a) => a.id === id) ? id : null;
    const rest = map.areas.filter((a) => a.id !== yourId).map(tileGeometry);
    tiles.geometry.dispose();
    tiles.geometry = mergeGeometries(rest, false);
    for (const g of rest) g.dispose();
    yours.geometry.dispose();
    const mine = map.areas.find((a) => a.id === yourId);
    yours.geometry = mine ? tileGeometry(mine) : new THREE.BufferGeometry();
  };
  setYourTile(null);

  // Roads: the highlight, drawn.
  add(ribbons(map.roads), lambert(colors.light), 'roads');

  // Lakes: a lavender that breathes (canvas.tsx animates the material).
  const waterColour = mix(colors.ground, colors.accent, night ? 0.35 : 0.15);
  const water = lambert(waterColour, {
    transparent: true, opacity: 0.85, depthWrite: false,
    emissive: waterColour, emissiveIntensity: night ? 0.35 : 0,
  });
  add(flatRings(map.water.map((w) => w.polygon), FLAT_Y + 0.004), water, 'water');

  // Parks, with sparse tree domes.
  add(flatRings(map.parks.map((p) => p.polygon), FLAT_Y), lambert(mix(colors.bg, colors.success, 0.2)), 'parks');
  const treeList = map.parks.flatMap((p) => p.trees);
  if (treeList.length) {
    const trees = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 6, 4), lambert(mix(colors.bg, colors.success, 0.4)), treeList.length);
    treeList.forEach((t, i) => {
      const s = t[2] ?? 1;
      dummy.position.set(t[0]!, 0.3 * s, t[1]!); dummy.rotation.set(0, 0, 0); dummy.scale.set(s, s * 0.9, s);
      dummy.updateMatrix(); trees.setMatrixAt(i, dummy.matrix);
    });
    trees.name = 'trees'; trees.frustumCulled = false;
    group.add(trees); meshes.push(trees); disposables.push(trees.geometry, trees.material as THREE.Material);
  }

  // Blocks: a density, not a footprint. Plain boxes: a rounded box is 300 triangles
  // and 455 of them were 136 K on their own, three times the whole budget, for a
  // corner nobody sees at the town's zoom (a block is ten to thirty pixels wide).
  const blockList = map.areas.flatMap((a) => a.blocks);
  const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lambert(mix(colors.light, colors.bg, 0.4)), blockList.length);
  blockList.forEach((b, i) => {
    const [x, z, w, d, h, rot] = b as [number, number, number, number, number, number];
    dummy.position.set(x, h / 2, z); dummy.rotation.set(0, rot, 0); dummy.scale.set(w, h, d);
    dummy.updateMatrix(); blocks.setMatrixAt(i, dummy.matrix);
  });
  blocks.name = 'blocks'; blocks.frustumCulled = false;
  group.add(blocks); meshes.push(blocks); disposables.push(blocks.geometry, blocks.material as THREE.Material);

  // Landmarks: eight icons in the shadow grey.
  add(landmarksGeometry(map), lambert(colors.prop), 'landmarks');

  // Lamps along the main roads: posts, and bulbs that glow in the evening.
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.045, 1.1, 5), lambert(colors.prop), map.lamps.length);
  const bulbs = lambert(colors.warning, { emissive: colors.warning, emissiveIntensity: night ? 0.9 : 0.15 });
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 6, 4), bulbs, map.lamps.length);
  map.lamps.forEach(([x, z], i) => {
    dummy.position.set(x, 0.55, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
    dummy.updateMatrix(); posts.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, 1.15, z); dummy.updateMatrix(); bulbMesh.setMatrixAt(i, dummy.matrix);
  });
  posts.name = 'posts'; bulbMesh.name = 'bulbs';
  for (const m of [posts, bulbMesh]) { m.frustumCulled = false; group.add(m); meshes.push(m); disposables.push(m.geometry, m.material as THREE.Material); }

  // Windows: warm dots on the two faces the camera sees, evening only.
  const windowCount = night ? countWindows(blockList) : 0;
  const windows = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.09), new THREE.MeshBasicMaterial({ color: '#FFD59A' }), Math.max(1, windowCount));
  windows.count = windowCount;
  if (windowCount) placeWindows(blockList, windows, dummy);
  windows.name = 'windows'; windows.frustumCulled = false;
  group.add(windows); meshes.push(windows); disposables.push(windows.geometry, windows.material as THREE.Material);

  // Taps: only the tiles answer the raycast. Roads, blocks and the rest would cost a
  // few thousand triangles per pointer event and say nothing a tile does not.
  for (const m of meshes) if (m !== tiles && m !== yours) m.raycast = () => {};

  return {
    group, water, bulbs, setYourTile,
    stats: () => ({
      meshes: meshes.length,
      triangles: meshes.reduce((s, m) => s + triangles(m.geometry) * (m instanceof THREE.InstancedMesh ? m.count : 1), 0),
    }),
    dispose: () => {
      for (const d of disposables) d.dispose();
      tiles.geometry.dispose(); yours.geometry.dispose();
    },
  };
}

/** Deterministic: the same block gets the same lit windows on every build. */
function windowsOf(b: number[], i: number): { u: number; v: number; face: 0 | 1 }[] {
  const [, , w, d, h] = b as [number, number, number, number, number];
  let s = (i * 2654435761) >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const out: { u: number; v: number; face: 0 | 1 }[] = [];
  const rows = Math.min(3, Math.floor(h / 0.16));
  for (const face of [0, 1] as const) {
    const width = face === 0 ? w : d;
    const cols = Math.min(3, Math.floor(width / 0.2));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (rnd() > 0.55) continue;
      out.push({ face, u: ((c + 0.5) / cols - 0.5) * width * 0.8, v: 0.1 + (r + 0.5) * ((h - 0.1) / rows) });
    }
  }
  return out;
}

function countWindows(blocks: number[][]): number {
  let n = 0;
  for (let i = 0; i < blocks.length && n < MAX_WINDOWS; i++) n += windowsOf(blocks[i]!, i).length;
  return Math.min(n, MAX_WINDOWS);
}

function placeWindows(blocks: number[][], mesh: THREE.InstancedMesh, dummy: THREE.Object3D): void {
  let k = 0;
  const q = new THREE.Quaternion(); const off = new THREE.Vector3();
  for (let i = 0; i < blocks.length && k < mesh.count; i++) {
    const b = blocks[i]!;
    const [x, z, w, d, , rot] = b as [number, number, number, number, number, number];
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    for (const win of windowsOf(b, i)) {
      if (k >= mesh.count) break;
      // face 0 is the +z side (normal +z), face 1 the +x side, in the block's own frame.
      if (win.face === 0) off.set(win.u, win.v, d / 2 + 0.006);
      else off.set(w / 2 + 0.006, win.v, win.u);
      off.applyQuaternion(q);
      dummy.position.set(x + off.x, off.y, z + off.z);
      dummy.rotation.set(0, rot + (win.face === 1 ? Math.PI / 2 : 0), 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(k++, dummy.matrix);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
}
