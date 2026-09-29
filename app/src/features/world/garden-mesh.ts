/**
 * The garden, drawn.
 *
 * Reached only from ./canvas.tsx, like ./map-mesh.ts, and listed beside it in
 * tests/native-imports.test.ts as a file allowed to import three.
 *
 * This is the one place in the app that does not wear the design system. Everything
 * else is one grey with depth from shadow, which is right for a card and right for a
 * map; a park at head height needs a sky, a horizon, green under your feet and warmth
 * in the light, or it reads as a diagram of a park. The founder put a game's garden
 * next to our city and asked for the garden (2026-09-22).
 *
 * Eleven draw calls: sky, hills, path, pond, trunks, canopies, grass, stone, leaves,
 * and the buildings in two colours with their windows unlit on top.
 * About nineteen thousand triangles. The grass sways in its vertex shader and the
 * leaves drift in the frame loop, and nothing else moves.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VIEW } from './camera';
import { PATH_WIDTH, TRUNK_BASE, type Garden } from './garden';
import { buildFence } from './fence-mesh';
import type { Pt } from './sim';

export interface GardenColors {
  /** Evening rather than afternoon: the same garden after dark. */
  night: boolean;
  /** The app's accent, for your own agent's disc and the water's tint. */
  accent: string;
}

export interface BuiltGarden {
  group: THREE.Group;
  /** Where the sky meets the ground. The scene's fog is set to this. */
  horizon: THREE.Color;
  /** Called every frame while the garden is on screen. */
  tick(t: number, dt: number): void;
  /** Where the person looking is, so the sky, the leaves and the grass follow them. */
  follow(x: number, y: number, z: number): void;
  /**
   * Draw only the trees, hedges and flowers the camera at (x, z) can see this side of
   * the mist. Call after the camera has been placed for the frame.
   */
  cull(view: Sees, x: number, z: number): void;
  stats(): { meshes: number; triangles: number };
  dispose(): void;
}

/** Can the camera see a ball this big standing here? (Viewport, ./visible.ts.) */
export interface Sees { sees(x: number, z: number, radius: number): boolean }

/**
 * Trees, hedges and flowers are filed in squares this many units across, and drawn a
 * square at a time: small enough that the squares in view are not much more than the
 * view, big enough that there are a couple of hundred of them to ask about, not
 * thousands of trees.
 */
export const SCENERY_CELL = 12;

/**
 * ONLY THE TREES YOU CAN SEE (the founder, 2026-09-28: "render only in view ... pubg
 * doesnt render the entire map").
 *
 * WHAT WAS WRONG. Every tree, hedge and flower in Cubbon Park was drawn every frame,
 * wherever you stood and whichever way you looked: 117,600 triangles of canopy, 50,400
 * of hedge, 14,000 of trunk and 10,422 of flower, the lot behind you included.
 * Measured on the Seeker, turning to face the trees took the frame from 407 K to 788 K
 * triangles and the park from 37 fps to 15.
 *
 * WHAT THIS DOES. The instances are sorted into squares once, when the park is built.
 * Each frame, the squares this side of the mist that the camera can see are copied to
 * the front of the mesh's own buffer, and it draws that many -- still one draw call,
 * and only the rows copied are sent to the GPU. When the same squares are in view as
 * last frame, which is most frames, nothing is copied or sent at all.
 */
function packByCell(mesh: THREE.InstancedMesh, cell = SCENERY_CELL) {
  const n = mesh.count;
  const src = mesh.instanceMatrix.array as Float32Array;
  const srcColour = mesh.instanceColor ? (mesh.instanceColor.array as Float32Array) : null;
  mesh.geometry.computeBoundingSphere();
  const reachOf = mesh.geometry.boundingSphere!.radius;
  const m = new THREE.Matrix4();
  const cellOf = (i: number) => [Math.floor(src[i * 16 + 12]! / cell), Math.floor(src[i * 16 + 14]! / cell)] as const;
  const keyOf = (i: number) => { const [cx, cz] = cellOf(i); return (cx + 512) * 1024 + (cz + 512); };
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => keyOf(a) - keyOf(b));
  const matrices = new Float32Array(n * 16);
  const colours = srcColour ? new Float32Array(n * 3) : null;
  const cells: { key: number; x: number; z: number; r: number; start: number; count: number }[] = [];
  order.forEach((i, k) => {
    matrices.set(src.subarray(i * 16, i * 16 + 16), k * 16);
    if (colours && srcColour) colours.set(srcColour.subarray(i * 3, i * 3 + 3), k * 3);
    const key = keyOf(i);
    let c = cells[cells.length - 1];
    if (!c || c.key !== key) {
      const [cx, cz] = cellOf(i);
      c = { key, x: (cx + 0.5) * cell, z: (cz + 0.5) * cell, r: 0, start: k, count: 0 };
      cells.push(c);
    }
    c.count++;
    // How far this one reaches from the middle of its square, height included: the
    // square's ball has to hold every leaf of every tree filed in it.
    m.fromArray(src, i * 16);
    const x = src[i * 16 + 12]!, y = src[i * 16 + 13]!, z = src[i * 16 + 14]!;
    c.r = Math.max(c.r, Math.hypot(x - c.x, z - c.z) + reachOf * m.getMaxScaleOnAxis() + Math.abs(y));
  });
  const kept: number[] = [];
  let keptN = -1;
  return {
    cull(view: Sees, x: number, z: number, see: number) {
      let k = 0;
      let same = true;
      for (let c = 0; c < cells.length; c++) {
        const cl = cells[c]!;
        if (Math.hypot(cl.x - x, cl.z - z) - cl.r > see) continue;
        if (!view.sees(cl.x, cl.z, cl.r)) continue;
        if (kept[k] !== c) { same = false; kept[k] = c; }
        k++;
      }
      if (same && k === keptN) return;
      keptN = k;
      const dst = mesh.instanceMatrix.array as Float32Array;
      const dstColour = mesh.instanceColor ? (mesh.instanceColor.array as Float32Array) : null;
      let at = 0;
      for (let j = 0; j < k; j++) {
        const cl = cells[kept[j]!]!;
        dst.set(matrices.subarray(cl.start * 16, (cl.start + cl.count) * 16), at * 16);
        if (colours && dstColour) dstColour.set(colours.subarray(cl.start * 3, (cl.start + cl.count) * 3), at * 3);
        at += cl.count;
      }
      mesh.count = at;
      mesh.visible = at > 0;
      if (!at) return;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, at * 16);
      mesh.instanceMatrix.needsUpdate = true;
      if (!mesh.instanceColor) return;
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, at * 3);
      mesh.instanceColor.needsUpdate = true;
    },
  };
}

export interface GardenMeshOptions {
  /** A venue GLB supplies benches and lamps; keep the procedural fallback otherwise. */
  assetFurniture?: boolean;
  /**
   * A city stands round this park (city-mesh.ts): the ground outside the fence is the
   * city's -- dust and concrete, and flat, for buildings to stand on -- not rolling
   * green hills.
   */
  city?: boolean;
}

/** Heights are in scene units against an agent drawn about 0.24 tall (PERSON). */
/**
 * A blade is about a fifth of a person. At 0.11 -- half their height -- the grass
 * read as dark cards standing about the field rather than as grass (on the phone,
 * 2026-09-22).
 */
const GRASS_H = 0.044;
/**
 * How much taller than GRASS_H a blade is drawn, before its own scale. It was 1.5,
 * which with the scales on top made the tallest blades a metre high -- waist high on a
 * person 1.75 m tall, and on the phone the lawn read as a hayfield round your knees
 * (the founder, 2026-09-29: "fix scale ... everything else"). At 0.65 a lawn is 13 to
 * 45 cm, ankle to knee (tests/park-scale.test.ts).
 */
const GRASS_TALL = 0.65;
/**
 * A bush: a sphere this big times its scale, standing BUSH_LIFT x scale off the ground
 * and squashed to 0.72 of its height. At 0.15 the park's bushes were 1.2 to 2.5 m tall,
 * taller than the people walking past them; at 0.105 they are 0.8 to 1.7 m, waist to
 * shoulder, and their colliders (garden.ts BUSH_R) shrank with them.
 */
export const BUSH_SIZE = 0.105;
const BUSH_LIFT = 0.0665;
const GRASS_W = 0.022;
const TRUNK_H = 1.15;
// Barely off the ground, and BELOW the disc drawn under your own agent (0.02 x
// PERSON). At 0.006 the path was above it and swallowed the one marker that tells
// you which of the figures is yours (on the phone, 2026-09-22).
const PATH_Y = 0.0012;
const POND_Y = 0.0008;
const LEAVES = 130;
/**
 * How far the ground goes before the haze takes over, for a 26-unit garden.
 *
 * SCALED BY THE PLACE, not fixed, because Cubbon Park is 170 units long: at a fixed 96
 * the ground plane ended inside the park and the hills started behind the player.
 */
const HILL_FAR_BASE = 96;
const hillFar = (radius: number) => Math.max(HILL_FAR_BASE, radius * 2.1);

/**
 * A closed ring pushed out from its own middle by `d` units.
 *
 * NOT A TRUE POLYGON OFFSET, which needs a mitre solved at every corner and can eat
 * its own thin parts. A building footprint at this size is a blob twenty to forty
 * metres across and a plinth stands about thirty centimetres proud, so scaling about
 * the centroid is within a few centimetres of right everywhere and is four lines.
 */
export function outset(ring: Pt[], d: number): Pt[] {
  let cx = 0; let cz = 0;
  for (const [x, z] of ring) { cx += x; cz += z; }
  cx /= ring.length; cz /= ring.length;
  let r = 0;
  for (const [x, z] of ring) r = Math.max(r, Math.hypot(x - cx, z - cz));
  const k = r > 0 ? (r + d) / r : 1;
  return ring.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k] as Pt);
}

/** A ring extruded between two heights, standing on the ground plane. */
export function prism(ring: Pt[], y0: number, y1: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  if (y0) geo.translate(0, y0, 0);
  geo.deleteAttribute('uv');
  return geo;
}

/** True when a point is inside a ring, by the usual crossing count. */
export function inside(px: number, pz: number, ring: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!; const [xj, zj] = ring[j]!;
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * A pillar every couple of metres round a ring, for a roof that stands on nothing else.
 *
 * Square posts, not cylinders: everything in this park is flat-shaded, a cylinder
 * costs a ring of triangles each, and at this size the difference is a pixel.
 *
 * NON-INDEXED, because they are merged with the prisms beside them and
 * `mergeGeometries` wants an index on all of them or on none. `BoxGeometry` carries
 * one and `ExtrudeGeometry` does not, so the first version of this returned null from
 * the merge and the whole park died on `new Mesh(null)`. The same trap took out a
 * whole character once, through a beard.
 */
export function posts(ring: Pt[], y0: number, y1: number): THREE.BufferGeometry[] {
  const STEP = 0.26;
  const R = 0.022;
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i]!; const [bx, bz] = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-4) continue;
    const n = Math.max(1, Math.round(len / STEP));
    // The last post of an edge is the first of the next, so it is left to that edge.
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const box = new THREE.BoxGeometry(R * 2, y1 - y0, R * 2);
      box.translate(ax + (bx - ax) * t, (y0 + y1) / 2, az + (bz - az) * t);
      const geo = box.toNonIndexed();
      box.dispose();
      geo.deleteAttribute('uv');
      out.push(geo);
    }
  }
  return out;
}

/** A window, in units: about 1.2 m across and 1.4 m tall, one every 2.6 m of wall. */
const PANE_W = 0.15;
const PANE_H = 0.17;
const PANE_GAP = 0.32;

/**
 * One storey's windows, all the way round a footprint, sitting a hair off the wall.
 *
 * OUTWARD IS DECIDED BY ASKING, not by trusting the winding: these rings come from
 * OSM by way of a scale and a simplify, and a ring that comes back clockwise would
 * hang every window inside the building where nobody would ever see one. So the
 * normal is tested against the ring itself and flipped if it points inwards.
 */
export function paneRow(ring: Pt[], y: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const y0 = y; const y1 = y + PANE_H;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i]!; const [bx, bz] = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < PANE_GAP) continue;
    const dx = (bx - ax) / len; const dz = (bz - az) / len;
    let nx = dz; let nz = -dx;
    const mx = (ax + bx) / 2; const mz = (az + bz) / 2;
    if (inside(mx + nx * 0.02, mz + nz * 0.02, ring)) { nx = -nx; nz = -nz; }
    const n = Math.floor(len / PANE_GAP);
    for (let k = 0; k < n; k++) {
      const t = (len - n * PANE_GAP) / 2 + PANE_GAP * (k + 0.5);
      const cx = ax + dx * t + nx * 0.006;
      const cz = az + dz * t + nz * 0.006;
      const hw = PANE_W / 2;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([
        cx - dx * hw, y0, cz - dz * hw,
        cx + dx * hw, y0, cz + dz * hw,
        cx + dx * hw, y1, cz + dz * hw,
        cx - dx * hw, y1, cz - dz * hw,
      ], 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(
        [nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz], 3));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      out.push(geo);
    }
  }
  return out;
}

interface Palette {
  skyTop: string; skyLow: string; hill: string; grass: string;
  path: string; pond: string; canopy: string; trunk: string; stone: string; leaf: string;
  wood: string; bush: string; reed: string;
  /** The library is red. A landmark the colour of every shed is not a landmark. */
  brick: string;
  /** What a window is: a hole, drawn unlit. */
  pane: string;
  sun: number; ambient: number;
}

/**
  * What is planted in the beds. A park has a few colours in it, not a rainbow -- and
  * nothing pure white, which at this size reads as litter rather than as a flower.
  */
const BLOOMS = ['#E0637E', '#E8B14C', '#C77BD6', '#F0D8A8', '#DE8A4C'] as const;
const DAY: Palette = {
  skyTop: '#8FB8DE', skyLow: '#DCE7EC', hill: '#A9C4A6', grass: '#86AA5E',
  path: '#D6C6A2', pond: '#7FA6C6', canopy: '#79A45C', trunk: '#7A644C',
  stone: '#9BA1A6', leaf: '#D9B65A', sun: 0.95, ambient: 0.85,
  wood: '#A8825A', bush: '#688F4C', reed: '#6E9450',
  brick: '#B05A42', pane: '#4A5560',
};
const NIGHT: Palette = {
  skyTop: '#1E2740', skyLow: '#55597A', hill: '#3B4752', grass: '#465B45',
  path: '#6E6654', pond: '#37506B', canopy: '#3A5540', trunk: '#453A2E',
  stone: '#565C63', leaf: '#8A7440', sun: 0.4, ambient: 0.55,
  wood: '#544432', bush: '#31462E', reed: '#3A4E33',
  brick: '#6B3325', pane: '#D8C070',
};

const mix = (a: string | THREE.Color, b: string | THREE.Color, t: number) =>
  new THREE.Color(a).lerp(new THREE.Color(b), t);

/** A ribbon down a polyline, mitred so the outer edge runs straight through a bend. */
function ribbon(line: readonly Pt[], width: number, y: number): THREE.BufferGeometry {
  const pos: number[] = []; const idx: number[] = [];
  const half = width / 2;
  const dirs: [number, number][] = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const dx = line[i + 1]![0] - line[i]![0]; const dz = line[i + 1]![1] - line[i]![1];
    const len = Math.hypot(dx, dz) || 1;
    dirs.push([dx / len, dz / len]);
  }
  for (let i = 0; i < line.length; i++) {
    const a = dirs[Math.max(0, i - 1)]!; const b = dirs[Math.min(dirs.length - 1, i)]!;
    let mx = -(a[1] + b[1]); let mz = a[0] + b[0];
    const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const out = half / Math.max(0.45, mx * -b[1] + mz * b[0]);
    const p = line[i]!;
    pos.push(p[0] + mx * out, y, p[1] + mz * out, p[0] - mx * out, y, p[1] - mz * out);
  }
  for (let i = 0; i + 1 < line.length; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

/** A flat ring laid on the ground, for the pond. */
function fill(ring: readonly Pt[], y: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

/**
 * Ground out to the horizon: flat where you walk, rolling beyond it. The hills are
 * what give the haze something to fade, and what stops the world ending in a line.
 */
function ground(radius: number, hills = true): THREE.BufferGeometry {
  const far = hillFar(radius);
  const g = new THREE.PlaneGeometry(far * 2, far * 2, 44, 44);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; hills && i < p.count; i++) {
    const x = p.getX(i); const z = p.getZ(i);
    const d = Math.hypot(x, z);
    // Nothing at all inside the garden, then rising with distance.
    // Rising within sight rather than beyond it: the haze ends at 90 units, so hills
    // that only got going at 80 were hills nobody ever saw.
    const k = Math.max(0, Math.min(1, (d - radius * 1.1) / (radius * 1.25)));
    const h = (Math.sin(x * 0.055) * Math.cos(z * 0.047) + Math.sin((x + z) * 0.031)) * 5.2;
    p.setY(i, h * k * k);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * One tuft: two blades crossed, each tapering to a point.
 *
 * EVERY NORMAL POINTS STRAIGHT UP, which is not what the geometry does and is exactly
 * right. A thin vertical surface under an overhead sun catches almost no light and
 * renders near black, so honestly-normalled grass is a field of dark cards -- which
 * is precisely what the first cut looked like. Pointing the normals at the sky is the
 * usual trick: each blade takes the same light as the ground it grows out of, and the
 * field reads as one surface with texture on it rather than as scenery standing up.
 */
function tuftGeometry(): THREE.BufferGeometry {
  const blade = () => {
    const g = new THREE.BufferGeometry();
    const w = GRASS_W; const h = GRASS_H;
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      -w / 2, 0, 0, w / 2, 0, 0,
      -w / 3, h * 0.55, 0, w / 3, h * 0.55, 0,
      0, h, 0,
    ], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(
      [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
    return g;
  };
  const a = blade(); const b = blade();
  b.rotateY(Math.PI / 2.2);
  const merged = mergeGeometries([a, b], false)!;
  a.dispose(); b.dispose();
  return merged;
}

/**
 * Wind, in the vertex shader, so fourteen hundred tufts cost one draw call and no
 * per-frame work on the JavaScript side. The phase comes from the instance's own
 * position, so the field ripples instead of pulsing as one.
 */
function windy(material: THREE.MeshLambertMaterial): { material: THREE.MeshLambertMaterial; time: { value: number } } {
  const time = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGwTime = time;
    shader.vertexShader = `uniform float uGwTime;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
         float gwPhase = instanceMatrix[3].x * 0.8 + instanceMatrix[3].z * 0.55;
       #else
         float gwPhase = 0.0;
       #endif
       float gwSway = sin(uGwTime * 1.7 + gwPhase) * 0.6 + sin(uGwTime * 2.9 + gwPhase * 1.6) * 0.4;
       float gwUp = max(0.0, position.y);
       transformed.x += gwSway * 0.9 * gwUp;
       transformed.z += gwSway * 0.5 * gwUp;`,
    );
  };
  return { material, time };
}

export function buildGarden(g: Garden, colors: GardenColors, options: GardenMeshOptions = {}): BuiltGarden {
  const P = colors.night ? NIGHT : DAY;
  const group = new THREE.Group();
  // Built hidden. The city is what the Home screen opens on, and a garden that starts
  // visible is a green field drawn over the whole map until you first walk and come
  // back (on the phone, 2026-09-22).
  group.visible = false;
  const meshes: THREE.Mesh[] = [];
  const junk: { dispose(): void }[] = [];
  /** Trees, hedges and flowers: drawn a square at a time, only the squares in view. */
  const scenery: ReturnType<typeof packByCell>[] = [];
  const dummy = new THREE.Object3D();
  const horizon = new THREE.Color(P.skyLow);

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name; m.frustumCulled = false;
    m.raycast = () => {};
    group.add(m); meshes.push(m); junk.push(geo, mat);
    return m;
  };

  // Sky: an inside-out dome, lit by nothing, graded from horizon to top. It rides
  // with the camera so you can never walk to the edge of it.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(hillFar(g.radius) * 1.6, 18, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: new THREE.Color(P.skyTop) }, uLow: { value: horizon } },
      vertexShader: 'varying float vH; void main(){ vH = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uTop; uniform vec3 uLow; varying float vH; void main(){ gl_FragColor = vec4(mix(uLow, uTop, clamp(vH*1.35+0.12,0.0,1.0)), 1.0); }',
    }),
  );
  sky.name = 'sky'; sky.frustumCulled = false; sky.renderOrder = -1; sky.raycast = () => {};
  group.add(sky); meshes.push(sky); junk.push(sky.geometry, sky.material as THREE.Material);

  // Ground and hills, one mesh: green underfoot fading into the haze.
  // The ground is a shade lighter than the blades standing in it. Matched, the grass
  // disappears into it and the field goes flat; this is what makes it read as texture.
  add(ground(g.radius, !options.city), new THREE.MeshLambertMaterial({
    color: options.city ? (colors.night ? '#3a3833' : '#C9C2B2') : mix(P.grass, P.hill, 0.3),
  }), 'ground');

  // THE PARK'S OWN SHAPE, laid over the plain. A surveyed boundary is the one thing a
  // person can actually recognise from a map, and without this the ground is the same
  // green everywhere and the place has no edges at all.
  {
    // LIGHTER THAN THE BLADES STANDING IN IT, for the same reason the ground is --
    // and the first cut of this mesh forgot, tinting the lawn toward white until it
    // was all but the blades' own green. Sixty thousand tufts drew and not one of
    // them could be seen: on the phone the park was a flat field (2026-09-23), and
    // scaling a blade up six times was what proved they had been there all along.
    const lawn = fill(g.outline, PATH_Y * 0.4);
    add(lawn, new THREE.MeshLambertMaterial({
      color: mix(P.grass, P.hill, 0.22),
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    }), 'lawn');
  }

  // Every path, at its own width, merged into one mesh. Cubbon Park is 185 of them and
  // 23 km; the seeded garden is one.
  {
    const parts = g.paths.filter((p) => p.line.length > 1).map((p) => ribbon(p.line, p.width, PATH_Y));
    const merged = parts.length > 1 ? mergeGeometries(parts, false)! : parts[0]!;
    if (parts.length > 1) for (const q of parts) q.dispose();
    add(merged, new THREE.MeshLambertMaterial({
      color: P.path, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }), 'path');
  }

  // THE FENCE round the outline, and a gate wherever a path meets it (fence-mesh.ts):
  // where the park stops you, you can see it stop.
  if (g.outline.length > 2) {
    const fence = buildFence(g.outline, g.gates, colors);
    for (const m of fence.meshes) { group.add(m); meshes.push(m); }
    junk.push(fence);
  }

  const pondMat = new THREE.MeshLambertMaterial({
    color: mix(P.pond, colors.accent, 0.12), transparent: true, opacity: 0.9, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    emissive: new THREE.Color(P.pond), emissiveIntensity: colors.night ? 0.3 : 0,
  });
  const waterRings = [...g.ponds, g.river].filter((w) => w.length > 2);
  if (waterRings.length) {
    const waterParts = waterRings.map((w) => fill(w, POND_Y));
    const water = waterParts.length > 1 ? mergeGeometries(waterParts, false)! : waterParts[0]!;
    if (waterParts.length > 1) for (const w of waterParts) w.dispose();
    add(water, pondMat, 'water');
  }

  // Trees: a trunk and three canopy blobs, two draw calls for the lot.
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.055, TRUNK_BASE, TRUNK_H, 5),
    new THREE.MeshLambertMaterial({ color: P.trunk }), Math.max(1, g.trees.length));
  // WHITE MATERIAL, COLOUR PER INSTANCE. An instance colour MULTIPLIES the material's,
  // so tinting both with the same green squares it: the canopies and the grass came
  // out near black and read as shadow rather than as foliage (on the phone,
  // 2026-09-22). Whatever carries a per-instance colour has a white material.
  const canopy = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.52, 7, 5),
    new THREE.MeshLambertMaterial({ color: '#ffffff' }), Math.max(1, g.trees.length * 3));
  const shade = new THREE.Color();
  g.trees.forEach((t, i) => {
    dummy.position.set(t.x, (TRUNK_H / 2) * t.scale, t.z);
    dummy.rotation.set(t.lean, 0, t.lean * 0.7);
    dummy.scale.set(t.scale, t.scale, t.scale);
    dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
    for (let k = 0; k < 3; k++) {
      const up = TRUNK_H * t.scale + (0.18 + k * 0.26) * t.scale;
      const wide = (k === 1 ? 1.15 : 0.82) * t.scale * (t.kind === 2 ? 1.18 : 1);
      dummy.position.set(t.x + t.lean * up * 1.4 + (k - 1) * 0.16 * t.scale, up, t.z + (k === 2 ? 0.12 : -0.08) * t.scale);
      dummy.rotation.set(0, t.lean * 3, 0);
      dummy.scale.set(wide, wide * (t.kind === 1 ? 1.25 : 0.88), wide);
      dummy.updateMatrix(); canopy.setMatrixAt(i * 3 + k, dummy.matrix);
      canopy.setColorAt(i * 3 + k, shade.set(P.canopy).multiplyScalar(0.84 + ((i * 7 + k * 3) % 9) / 26));
    }
  });
  for (const m of [trunks, canopy]) {
    m.name = m === trunks ? 'trunks' : 'canopies'; m.frustumCulled = false; m.raycast = () => {};
    // A count that changes every time the view does: pinned, so three never freezes
    // one around whatever was drawn first (see worldSphere in canvas.tsx).
    m.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    group.add(m); meshes.push(m); junk.push(m.geometry, m.material as THREE.Material);
    scenery.push(packByCell(m));
  }

  // Grass.
  // FRONT FACES ONLY. Three flips the normal on a back face, so with DoubleSide the
  // sky-facing normals that make grass catch the light become ground-facing on half
  // the blades and that half renders black. Two blades crossed at eighty degrees
  // means one of them always faces you, which is what DoubleSide was there for.
  const grassMat = new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.FrontSide });
  const { time: windTime } = windy(grassMat);
  // The reeds ride along in the same mesh: same blades, taller and bluer, so the
  // water's edge sways with everything else and costs no extra draw call.
  //
  // ONE MESH PER PATCH OF GROUND, NOT ONE FOR THE PARK. The seeded garden put 7,000
  // tufts in a 26-unit circle and drew all of them, always, which was fine: that is
  // one draw call and the whole circle is in front of you. Cubbon Park is nine times
  // the area, and the same density is 24,000 blades -- and the park already measured
  // at 59.8 fps with grass as more than half its triangles.
  //
  // So the grass is cut into a grid. Each cell is its own instanced mesh with its own
  // real bounding sphere, which makes three's frustum culling work on it -- and a
  // cell more than GRASS_SEE away from the player is switched off outright in
  // `follow` below, because the haze hides it long before that anyway. Near a player
  // that is six or eight meshes of a few hundred blades instead of one of 24,000.
  //
  // THE BOUNDING SPHERE IS SAFE HERE and is not in the crowd: an instanced mesh
  // computes its sphere once from instances 0..count-1 and never invalidates it, so a
  // VARYING count freezes it wrongly. These counts never change after they are filled.
  const GRASS_CELL = 16;
  const grassCells: THREE.InstancedMesh[] = [];
  {
    type Blade = { x: number; z: number; rot: number; scale: number; reed: boolean; i: number };
    const cells = new Map<string, Blade[]>();
    const put = (b: Blade) => {
      const k = `${Math.floor(b.x / GRASS_CELL)},${Math.floor(b.z / GRASS_CELL)}`;
      const at = cells.get(k);
      if (at) at.push(b); else cells.set(k, [b]);
    };
    g.tufts.forEach((t, i) => put({ x: t.x, z: t.z, rot: t.rot, scale: t.scale, reed: false, i }));
    // The reeds ride along in the same meshes: same blades, taller and bluer, so the
    // water's edge sways with everything else and costs no extra draw call.
    g.reeds.forEach((r, i) => put({ x: r.x, z: r.z, rot: r.rot, scale: r.scale, reed: true, i }));

    const geo = tuftGeometry();
    junk.push(geo);
    for (const blades of cells.values()) {
      const mesh = new THREE.InstancedMesh(geo, grassMat, blades.length);
      blades.forEach((b, k) => {
        dummy.position.set(b.x, 0, b.z);
        dummy.rotation.set(0, b.rot, 0);
        if (b.reed) dummy.scale.set(b.scale * 0.7, b.scale * 2.6, b.scale * 0.7);
        else dummy.scale.set(b.scale, b.scale * (0.8 + (b.i % 5) * 0.1) * GRASS_TALL, b.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(k, dummy.matrix);
        mesh.setColorAt(k, b.reed
          ? shade.set(P.reed).multiplyScalar(0.8 + ((b.i * 7) % 9) / 26)
          : shade.set(P.grass).multiplyScalar(0.74 + ((b.i * 11) % 13) / 42));
      });
      mesh.name = 'grass';
      mesh.raycast = () => {};
      mesh.computeBoundingSphere();
      group.add(mesh); meshes.push(mesh); grassCells.push(mesh);
    }
    junk.push(grassMat);
  }

  // A bridge where the path fords the river. Without one the river is a wall and the
  // path stops being a path; the sim is told the same thing in gardenSpots.
  if (g.bridge) {
    const b = g.bridge;
    const parts: THREE.BufferGeometry[] = [];
    const deck = new THREE.BoxGeometry(b.width, 0.035, b.span);
    deck.translate(0, 0.055, 0); parts.push(deck);
    for (const side of [-1, 1]) {
      const rail = new THREE.BoxGeometry(0.03, 0.025, b.span);
      rail.translate((b.width / 2 - 0.02) * side, 0.145, 0); parts.push(rail);
      for (const end of [-1, 1]) {
        const post = new THREE.BoxGeometry(0.035, 0.12, 0.035);
        post.translate((b.width / 2 - 0.02) * side, 0.1, (b.span / 2 - 0.06) * end); parts.push(post);
      }
    }
    for (const q of parts) { q.deleteAttribute('uv'); q.rotateY(b.rot); q.translate(b.x, 0, b.z); }
    const merged = mergeGeometries(parts, false)!;
    for (const q of parts) q.dispose();
    add(merged, new THREE.MeshLambertMaterial({ color: P.wood }), 'bridge');
  }

  // The fountain: a stone basin with water in it and a bowl on a column above.
  //
  // ONLY IF THERE IS ONE. A seeded garden always has a fountain; a surveyed place has
  // whatever the survey found, and Cubbon Park's is not in OSM. Drawn at radius zero
  // the basin collapses to nothing but the column and the bowl still stand -- so the
  // park opened with a three-metre grey mushroom in front of the camera, which is
  // exactly what it looked like on the phone (2026-09-23).
  if (g.fountain.radius > 0) {
    const parts: THREE.BufferGeometry[] = [];
    const basin = new THREE.CylinderGeometry(g.fountain.radius, g.fountain.radius * 1.04, 0.1, 20);
    basin.translate(0, 0.05, 0); parts.push(basin);
    const column = new THREE.CylinderGeometry(0.1, 0.14, 0.3, 8);
    column.translate(0, 0.25, 0); parts.push(column);
    const bowl = new THREE.CylinderGeometry(0.4, 0.26, 0.06, 12);
    bowl.translate(0, 0.42, 0); parts.push(bowl);
    for (const q of parts) { q.deleteAttribute('uv'); q.translate(g.fountain.x, 0, g.fountain.z); }
    const merged = mergeGeometries(parts, false)!;
    for (const q of parts) q.dispose();
    add(merged, new THREE.MeshLambertMaterial({ color: P.stone }), 'fountain');
    const pool = new THREE.CircleGeometry(g.fountain.radius * 0.92, 20);
    pool.rotateX(-Math.PI / 2);
    pool.translate(g.fountain.x, 0.101, g.fountain.z);
    add(pool, new THREE.MeshLambertMaterial({ color: mix(P.pond, '#ffffff', 0.12) }), 'fountain-water');
  }

  // Benches, all of them one mesh. Somewhere to sit is most of what makes a field a
  // park, and they are what the people standing about are standing about near.
  if (g.benches.length && !options.assetFurniture) {
    const parts: THREE.BufferGeometry[] = [];
    for (const bn of g.benches) {
      const bits: THREE.BufferGeometry[] = [];
      const seat = new THREE.BoxGeometry(0.34, 0.018, 0.12); seat.translate(0, 0.06, 0); bits.push(seat);
      const back = new THREE.BoxGeometry(0.34, 0.08, 0.016); back.translate(0, 0.105, -0.05); bits.push(back);
      for (const side of [-1, 1]) {
        const leg = new THREE.BoxGeometry(0.024, 0.06, 0.1);
        leg.translate(0.14 * side, 0.03, 0); bits.push(leg);
      }
      for (const q of bits) { q.deleteAttribute('uv'); q.rotateY(bn.rot); q.translate(bn.x, 0, bn.z); }
      parts.push(...bits);
    }
    const merged = mergeGeometries(parts, false)!;
    for (const q of parts) q.dispose();
    add(merged, new THREE.MeshLambertMaterial({ color: P.wood }), 'benches');
  }

  // Hedges.
  if (g.bushes.length) {
    // A hedge is about waist high on a person, not shoulder high: at 0.3 they were
    // boulders with leaves (on the phone, 2026-09-22). See BUSH_SIZE for the rest.
    const bushMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(BUSH_SIZE, 7, 5),
      new THREE.MeshLambertMaterial({ color: '#ffffff' }), g.bushes.length);
    g.bushes.forEach((b, i) => {
      dummy.position.set(b.x, BUSH_LIFT * b.scale, b.z);
      dummy.rotation.set(0, i * 1.1, 0);
      dummy.scale.set(b.scale, b.scale * 0.72, b.scale * 0.92);
      dummy.updateMatrix(); bushMesh.setMatrixAt(i, dummy.matrix);
      bushMesh.setColorAt(i, shade.set(P.bush).multiplyScalar(0.84 + ((i * 13) % 11) / 30));
    });
    bushMesh.name = 'bushes'; bushMesh.frustumCulled = false; bushMesh.raycast = () => {};
    bushMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    group.add(bushMesh); meshes.push(bushMesh); junk.push(bushMesh.geometry, bushMesh.material as THREE.Material);
    scenery.push(packByCell(bushMesh));
  }

  // Flowers, in beds. Normals up, like the grass, for the same reason.
  if (g.flowers.length) {
    const bloom = new THREE.InstancedMesh(
      tuftGeometry(), new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.FrontSide }), g.flowers.length);
    g.flowers.forEach((f, i) => {
      dummy.position.set(f.x, 0, f.z);
      dummy.rotation.set(0, i * 2.4, 0);
      // Knee high on a person: at 1.7 the tallest stood at 73 cm (the size test).
      dummy.scale.set(f.scale * 1.3, f.scale * 1.3, f.scale * 1.3);
      dummy.updateMatrix(); bloom.setMatrixAt(i, dummy.matrix);
      bloom.setColorAt(i, shade.set(BLOOMS[Math.floor(f.tint * BLOOMS.length) % BLOOMS.length]!));
    });
    bloom.name = 'flowers'; bloom.frustumCulled = false; bloom.raycast = () => {};
    bloom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    group.add(bloom); meshes.push(bloom); junk.push(bloom.geometry, bloom.material as THREE.Material);
    scenery.push(packByCell(bloom));
  }

  // Lanterns and rocks, merged into one piece of stone.
  const stone: THREE.BufferGeometry[] = [];
  for (const p of g.props) {
    if (p.kind === 'lantern') {
      if (options.assetFurniture) continue;
      const post = new THREE.CylinderGeometry(0.035, 0.05, 0.18, 6); post.translate(0, 0.09, 0);
      const body = new THREE.BoxGeometry(0.11, 0.09, 0.11); body.translate(0, 0.225, 0);
      const roof = new THREE.ConeGeometry(0.11, 0.07, 4); roof.translate(0, 0.305, 0);
      for (const piece of [post, body, roof]) {
        piece.rotateY(p.rot); piece.translate(p.x, 0, p.z);
        piece.deleteAttribute('uv'); stone.push(piece);
      }
    } else {
      const r = new THREE.SphereGeometry(0.115, 6, 4);
      r.scale(1, 0.62, 0.85); r.rotateY(p.rot); r.translate(p.x, 0.045, p.z);
      r.deleteAttribute('uv'); stone.push(r);
    }
  }
  if (stone.length) {
    const merged = mergeGeometries(stone, false)!;
    for (const s of stone) s.dispose();
    add(merged, new THREE.MeshLambertMaterial({ color: P.stone }), 'stone');
  }

  // Buildings. The State Central Library, the bandstand, the Fern House -- surveyed
  // footprints extruded to a guessed height, because OSM records the plan and not the
  // elevation.
  //
  // A FOOTPRINT EXTRUDED IS A CRATE, NOT A BUILDING. That is exactly what this was:
  // the founder walked up to the library and asked why there was a huge box in the
  // middle of the road (2026-09-23). It was the right size and the right place and it
  // still read as an untextured placeholder, because next to hand-made trees and
  // benches a bare grey prism is the one thing in the park with no edges in it.
  //
  // Three cheap things fix that, and none of them is a texture. A PLINTH, because a
  // building meets the ground on something wider than itself. A CORNICE, the thin
  // overhanging slab at the top, which is what actually reads as a roof from the
  // ground. And WINDOWS -- small dark quads a hair off each wall, in rows by storey --
  // which are what give a wall its scale: without them nothing says whether the thing
  // is ten metres tall or a hundred. The library also gets its own red, because it is
  // red, and a landmark that is the colour of every shed in the park is not a landmark.
  if (g.buildings.length) {
    const stoneWalls: THREE.BufferGeometry[] = [];
    const brickWalls: THREE.BufferGeometry[] = [];
    const panes: THREE.BufferGeometry[] = [];
    /** One storey, in units: about three and a half metres of Cubbon Park. */
    const STOREY = 0.43;
    for (const b of g.buildings) {
      if (b.ring.length < 3) continue;
      const brick = /library/i.test(b.name);
      const into = brick ? brickWalls : stoneWalls;
      // THE BANDSTAND HAS NO WALLS. It is a roof on pillars and always was -- the code
      // that guessed its height said so in a comment while the mesh drew a solid
      // eight-metre cube, standing on the path circle a minute's walk from where you
      // spawn. That cube is what the founder saw and asked about, in those words: a
      // huge box in the middle of the road (2026-09-23). Pillars stand ON the ring, so
      // you still stop where the collision already stops you.
      if (/band/i.test(b.name)) {
        into.push(prism(outset(b.ring, 0.04), 0, 0.09));
        into.push(...posts(b.ring, 0.09, b.height));
        into.push(prism(outset(b.ring, 0.055), b.height, b.height + 0.07));
        continue;
      }
      into.push(prism(b.ring, 0, b.height));
      // The plinth sits proud of the wall and the cornice overhangs it. Both are the
      // same ring pushed out from its own middle, which is exact enough at this size
      // and costs nothing -- a true polygon offset would be a mitre per corner.
      into.push(prism(outset(b.ring, 0.035), 0, 0.055));
      into.push(prism(outset(b.ring, 0.03), b.height, b.height + 0.05));
      // Windows start above the plinth and stop below the cornice, so a one-storey
      // shed gets a single row and the library gets four.
      const rows = Math.max(1, Math.floor((b.height - 0.18) / STOREY));
      for (let r = 0; r < rows; r++) panes.push(...paneRow(b.ring, 0.16 + r * STOREY));
    }
    const put = (parts: THREE.BufferGeometry[], color: string, name: string) => {
      if (!parts.length) return;
      const merged = parts.length > 1 ? mergeGeometries(parts, false)! : parts[0]!;
      if (parts.length > 1) for (const q of parts) q.dispose();
      add(merged, new THREE.MeshLambertMaterial({ color }), name);
    };
    put(stoneWalls, P.stone, 'buildings');
    put(brickWalls, P.brick, 'buildings-brick');
    // Unlit, because a window is a hole and a hole does not catch the sun.
    if (panes.length) {
      const merged = mergeGeometries(panes, false)!;
      for (const q of panes) q.dispose();
      add(merged, new THREE.MeshBasicMaterial({ color: P.pane }), 'windows');
    }
  }

  // The statues, and the rock. Cubbon Park's landmarks are mostly a figure on a
  // plinth, so that is what these are: nobody is modelling Queen Victoria at twenty
  // pixels tall, and a plinth with something on it reads as a statue from anywhere.
  if (g.landmarks.length) {
    const parts: THREE.BufferGeometry[] = [];
    for (const l of g.landmarks) {
      const bits: THREE.BufferGeometry[] = [];
      if (l.kind === 'rock') {
        const r = new THREE.SphereGeometry(0.42, 7, 5);
        r.scale(1.3, 0.8, 1); bits.push(r);
      } else {
        const base = new THREE.BoxGeometry(0.3, 0.22, 0.3); base.translate(0, 0.11, 0); bits.push(base);
        const plinth = new THREE.BoxGeometry(0.2, 0.3, 0.2); plinth.translate(0, 0.37, 0); bits.push(plinth);
        const body = new THREE.CylinderGeometry(0.05, 0.075, 0.28, 6); body.translate(0, 0.66, 0); bits.push(body);
        const head = new THREE.SphereGeometry(0.052, 6, 4); head.translate(0, 0.83, 0); bits.push(head);
      }
      for (const q of bits) { q.deleteAttribute('uv'); q.translate(l.x, 0, l.z); }
      parts.push(...bits);
    }
    const merged = mergeGeometries(parts, false)!;
    for (const q of parts) q.dispose();
    add(merged, new THREE.MeshLambertMaterial({ color: mix(P.stone, '#ffffff', 0.18) }), 'landmarks');
  }

  // Leaves on the air. Few enough to write by hand each frame.
  const leafGeo = new THREE.PlaneGeometry(0.05, 0.035);
  const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshBasicMaterial({
    color: P.leaf, side: THREE.DoubleSide, transparent: true, opacity: 0.85,
  }), LEAVES);
  // AROUND THE PLAYER, NOT ACROSS THE PARK. Spread over a 170-unit park, 130 leaves
  // are one leaf every thirty metres and you never see one. The patch is a few units
  // wide and rides with whoever is looking (see `follow`).
  const LEAF_SPREAD = 14;
  const drift = Array.from({ length: LEAVES }, (_, i) => ({
    x: (((i * 37) % 100) / 100 - 0.5) * LEAF_SPREAD,
    z: (((i * 61) % 100) / 100 - 0.5) * LEAF_SPREAD,
    y: ((i * 17) % 100) / 100,
    s: 0.4 + (((i * 23) % 70) / 100),
  }));
  const eye = { x: 0, z: 0 };
  leaves.name = 'leaves'; leaves.frustumCulled = false; leaves.raycast = () => {};
  group.add(leaves); meshes.push(leaves); junk.push(leafGeo, leaves.material as THREE.Material);

  const tick = (t: number, _dt: number) => {
    windTime.value = t;
    pondMat.opacity = 0.84 + 0.1 * (0.5 + 0.5 * Math.sin(t * (Math.PI / 2)));
    for (let i = 0; i < LEAVES; i++) {
      const d = drift[i]!;
      const fall = (d.y + t * 0.055 * d.s) % 1;
      dummy.position.set(
        eye.x + d.x + Math.sin(t * 0.6 + i) * 0.5,
        2.4 * (1 - fall) + 0.05,
        eye.z + d.z + Math.cos(t * 0.45 + i * 1.7) * 0.5,
      );
      dummy.rotation.set(t * 0.8 + i, t * 1.1 + i, 0);
      dummy.scale.setScalar(d.s);
      dummy.updateMatrix();
      leaves.setMatrixAt(i, dummy.matrix);
    }
    leaves.instanceMatrix.needsUpdate = true;
  };

  const tris = (m: THREE.Mesh) => {
    const geo = m.geometry;
    const n = geo.index ? geo.index.count : (geo.getAttribute('position')?.count ?? 0);
    return (n / 3) * (m instanceof THREE.InstancedMesh ? m.count : 1);
  };

  /**
   * Everything that has to move with whoever is looking, once a frame.
   *
   * The sky dome, the drifting leaves, and -- the one that matters for a park this
   * size -- which cells of grass are switched on at all. Distance, not the frustum:
   * three culls what is behind you for free, but a cell four hundred metres ahead is
   * still in front of you and still costs a draw call, and the haze has hidden it
   * since sixty.
   */
  const GRASS_SEE = 34;
  const follow = (x: number, y: number, z: number) => {
    eye.x = x; eye.z = z;
    if (sky) sky.position.set(x, y, z);
    for (const cell of grassCells) {
      const c = cell.boundingSphere;
      cell.visible = !c || Math.hypot(c.center.x - x, c.center.z - z) - c.radius < GRASS_SEE;
    }
  };

  const cull = (view: Sees, x: number, z: number) => {
    for (const s of scenery) s.cull(view, x, z, VIEW);
  };

  return {
    group, horizon, tick, follow, cull,
    stats: () => ({
      meshes: meshes.filter((m) => m.visible).length,
      triangles: Math.round(meshes.filter((m) => m.visible).reduce((s, m) => s + tris(m), 0)),
    }),
    dispose: () => { for (const j of junk) j.dispose(); },
  };
}

/**
 * The sky dome has to follow the camera, or you walk out from under it -- and so do
 * the leaves, and so does the question of which grass is worth drawing.
 *
 * Kept as a function rather than folded into the caller because `canvas.tsx` already
 * calls it once a frame with the camera, and because searching the group for the sky
 * by name every frame (which is what this used to do) is a linear scan over a hundred
 * meshes now that the grass is cut into cells.
 */
export function skyFollow(built: BuiltGarden, x: number, y: number, z: number): void {
  built.follow(x, y, z);
}
