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
import { TREE, type MapAreaAsset, type MapAsset } from './map';
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

/**
 * Tile top is y = 0 and the body hangs below it. The plate underneath sits just
 * below the tops, NOT below the bodies: with a tile 0.38 deep and a 0.3 gap between
 * tiles, a plate at the bottom turned every neighbourhood boundary into a trench
 * four times a person's height, and walking the streets meant crossing canyons
 * (2026-09-22). At 0.05 the gaps read as seams -- still there from above, where the
 * bevel and the skirt do the separating, but nothing to fall into down in the city.
 */
const TILE_DEPTH = 0.22;
const BEVEL = 0.08;
const PLATE_Y = -0.05;
const SKIRT_Y = PLATE_Y + 0.012;
const SKIRT_OFFSET = 0.3;
const ROAD_Y = 0.012;
const FLAT_Y = 0.008;
/**
 * Roads, lakes and parks lie flat ON the tiles, a few millimetres above them, which
 * is exactly the case a depth buffer cannot call: whichever it picks varies pixel by
 * pixel and the ground shreds. Lifting them further apart would show as a step at the
 * walking camera's height, so instead they are biased toward the viewer in depth only
 * -- the standard way to lay a marking on a road -- and the argument never happens.
 */
const DECAL = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 } as const;
/**
 * A street is wide enough to walk down, and no wider. The people are about 0.24 units
 * tall, so a half-unit road is two of them across. At 0.9 it was wider than the
 * buildings beside it and the ground read as one continuous grey slab.
 */
const ROAD_WIDTH: Record<string, number> = { trunk: 0.52, primary: 0.38, secondary: 0.26 };
const MAX_WINDOWS = 900;

const mix = (a: string | THREE.Color, b: string | THREE.Color, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t);
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
 * Roads, as a mitred ribbon per run.
 *
 * Two earlier attempts are worth remembering. The first offset every point along the
 * perpendicular of its neighbours and shared vertices between segments: at any corner
 * sharper than a gentle bend the two offset points cross, the quad becomes a bow tie,
 * and a long thin wedge draws across the street. Once the roads were widened to
 * something a person could walk down it covered the ground in torn grey shapes --
 * "why does it look like half renders" (2026-09-22). The second gave every segment
 * its own rectangle, which cannot cross but leaves the union of them with a sawtooth
 * edge wherever the road bends.
 *
 * This one mitres properly: each point is offset along the bisector of its two
 * segments, lengthened by 1/cos(half the turn) so the outer edge stays straight
 * through the corner. That blows up on a hairpin, so the length is capped and the run
 * is cut there and started again -- a clean end and a clean start beats a spike.
 */
const MITRE_MIN_COS = 0.4;

function ribbons(roads: Record<string, Pt[][]>): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const dirOf = (a: Pt, b: Pt): [number, number] | null => {
    const dx = b[0] - a[0]; const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    return len < 1e-6 ? null : [dx / len, dz / len];
  };

  const emit = (run: Pt[], half: number) => {
    if (run.length < 2) return;
    const dirs: [number, number][] = [];
    for (let i = 0; i + 1 < run.length; i++) {
      const d = dirOf(run[i]!, run[i + 1]!);
      if (d) dirs.push(d); else { run.splice(i + 1, 1); i--; }
    }
    if (dirs.length === 0) return;
    const start = pos.length / 3;
    for (let i = 0; i < run.length; i++) {
      const dIn = dirs[Math.max(0, i - 1)]!;
      const dOut = dirs[Math.min(dirs.length - 1, i)]!;
      // The bisector of the two segment normals, lengthened so the outer edge of the
      // ribbon runs straight through the corner rather than pinching in at it.
      let mx = -(dIn[1] + dOut[1]); let mz = dIn[0] + dOut[0];
      const mlen = Math.hypot(mx, mz) || 1;
      mx /= mlen; mz /= mlen;
      const cos = Math.max(MITRE_MIN_COS, mx * -dOut[1] + mz * dOut[0]);
      const out = half / cos;
      const p = run[i]!;
      pos.push(p[0] + mx * out, ROAD_Y, p[1] + mz * out,
               p[0] - mx * out, ROAD_Y, p[1] - mz * out);
    }
    for (let i = 0; i + 1 < run.length; i++) {
      const a = start + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  };

  for (const [cls, lines] of Object.entries(roads)) {
    const w = ROAD_WIDTH[cls];
    if (w === undefined) continue;
    const half = w * 0.5;
    for (const line of lines) {
      // Cut the line wherever it doubles back on itself: a mitre there would be a
      // spike several times the width of the road.
      let run: Pt[] = [];
      let last: [number, number] | null = null;
      for (let i = 0; i < line.length; i++) {
        const d = i + 1 < line.length ? dirOf(line[i]!, line[i + 1]!) : null;
        if (last && d && last[0] * d[0] + last[1] * d[1] < 0.15) {
          run.push(line[i]!);
          emit(run, half);
          run = [];
        }
        run.push(line[i]!);
        if (d) last = d;
      }
      emit(run, half);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
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

/**
 * Landmarks are drawn three-quarter size. Their parts were sized against buildings a
 * person could step over; now that a building is a building, a full-size dome sat
 * over the city like a planet (on the phone, 2026-09-22).
 */
const LANDMARK = 0.75;

function landmarksGeometry(map: MapAsset): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const l of map.landmarks) {
    for (const p of landmark(l.kind)) {
      const g = p.g;
      g.scale(LANDMARK, LANDMARK, LANDMARK);
      if (p.rx) g.rotateX(p.rx);
      if (p.rz) g.rotateZ(p.rz);
      if (p.ry) g.rotateY(p.ry);
      g.translate((p.x ?? 0) * LANDMARK, (p.y ?? 0) * LANDMARK, (p.z ?? 0) * LANDMARK);
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
  // Your neighbourhood, plainly -- but only as plainly as it needs to be. At 22 % the
  // tint vanished under the buildings when the whole tile was in view; at 42 % it was
  // a lavender floor once the camera came down into the streets. This reads at both
  // (on the phone, 2026-09-22).
  const yoursMaterial = lambert(mix(colors.bg, colors.accent, 0.3));
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

  // ROADS ARE A CHANNEL, NOT A HIGHLIGHT. White on a near-white tile was legible
  // while the ground was empty; once buildings covered it, the street network
  // disappeared into them and the city read as gravel (on the phone, 2026-09-22).
  // A road is now a shade darker than the ground it cuts through, which is what makes
  // the grid readable from any height. The highlight edge that the design system asks
  // for is still there -- it is the tile's own bevel, catching the light top-left.
  add(ribbons(map.roads), lambert(mix(colors.bg, colors.prop, night ? 0.55 : 0.72), { ...DECAL }), 'roads');

  // Lakes: a lavender that breathes (canvas.tsx animates the material).
  // Lakes at 15 % accent were grey with a rumour of purple in them; a lake has to read
  // as water from across the city or the map is one flat grey (seen on the phone,
  // 2026-09-22). Same for the parks and their trees below.
  const waterColour = mix(colors.ground, colors.accent, night ? 0.45 : 0.4);
  const water = lambert(waterColour, {
    transparent: true, opacity: 0.85, depthWrite: false, ...DECAL,
    emissive: waterColour, emissiveIntensity: night ? 0.35 : 0,
  });
  add(flatRings(map.water.map((w) => w.polygon), FLAT_Y + 0.004), water, 'water');

  // Parks, with sparse tree domes.
  add(flatRings(map.parks.map((p) => p.polygon), FLAT_Y), lambert(mix(colors.bg, colors.success, 0.34), { ...DECAL }), 'parks');
  const treeList = map.parks.flatMap((p) => p.trees);
  if (treeList.length) {
    const treeColour = mix(colors.bg, colors.success, 0.62);
    // A canopy, not a hill. At 0.34 they were wider than the buildings beside them
    // (on the phone, 2026-09-22); TREE is shared with map.ts, which blocks walking
    // through the same circle.
    const trees = new THREE.InstancedMesh(new THREE.SphereGeometry(TREE, 6, 4), lambert('#ffffff'), treeList.length);
    const shade = new THREE.Color();
    treeList.forEach((t, i) => {
      const s = t[2] ?? 1;
      dummy.position.set(t[0]!, TREE * 0.85 * s, t[1]!); dummy.rotation.set(0, 0, 0); dummy.scale.set(s, s * 0.9, s);
      dummy.updateMatrix(); trees.setMatrixAt(i, dummy.matrix);
      // A wood, not a stamp: each tree a shade off its neighbour. Instance colours are
      // free -- same mesh, same draw call.
      trees.setColorAt(i, shade.copy(treeColour).multiplyScalar(0.86 + ((i * 37) % 11) / 39));
    });
    trees.name = 'trees'; trees.frustumCulled = false;
    group.add(trees); meshes.push(trees); disposables.push(trees.geometry, trees.material as THREE.Material);
  }

  // Blocks: a density, not a footprint. Plain boxes: a rounded box is 300 triangles
  // and 455 of them were 136 K on their own, three times the whole budget, for a
  // corner nobody sees at the town's zoom (a block is ten to thirty pixels wide).
  const blockList = map.areas.flatMap((a) => a.blocks);
  // A touch of warmth in the walls. The palette is a cool blue-grey throughout, which
  // is right for a card and reads as concrete over a whole city; a few percent toward
  // a warm off-white is sunlight on a building, not a second colour in the app.
  const blockColour = night ? mix(colors.bg, colors.light, 0.5) : mix(mix(colors.light, colors.bg, 0.06), '#FFF6E8', 0.22);
  const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lambert('#ffffff'), blockList.length);
  const wall = new THREE.Color();
  blockList.forEach((b, i) => {
    const [x, z, w, d, h, rot] = b as [number, number, number, number, number, number];
    dummy.position.set(x, h / 2, z); dummy.rotation.set(0, rot, 0); dummy.scale.set(w, h, d);
    dummy.updateMatrix(); blocks.setMatrixAt(i, dummy.matrix);
    // Seven hundred buildings in one colour are a texture; a few percent apart, they
    // are a skyline. The taller ones go a shade darker, as distance does.
    blocks.setColorAt(i, wall.copy(blockColour).multiplyScalar(0.92 + ((i * 53) % 13) / 78 - Math.min(0.08, h * 0.03)));
  });
  blocks.name = 'blocks'; blocks.frustumCulled = false;
  group.add(blocks); meshes.push(blocks); disposables.push(blocks.geometry, blocks.material as THREE.Material);

  // Landmarks: eight icons in the shadow grey.
  add(landmarksGeometry(map), lambert(colors.prop), 'landmarks');

  // LAMPS ARE AN EVENING THING. Lit, they are what carries the dark theme. In
  // daylight a hundred posts with orange tips read as map pins dropped over the whole
  // city -- the single noisiest thing on the screen (on the phone, 2026-09-22) -- and
  // an unlit lamp post says nothing a building does not. So: count 0 by day, exactly
  // as the windows do, and no draw call for either.
  const lampCount = night ? map.lamps.length : 0;
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.045, 1.1, 5), lambert(colors.prop), Math.max(1, map.lamps.length));
  const bulbs = lambert(colors.warning, { emissive: colors.warning, emissiveIntensity: night ? 0.9 : 0.15 });
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 6, 4), bulbs, Math.max(1, map.lamps.length));
  posts.count = lampCount; bulbMesh.count = lampCount;
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
