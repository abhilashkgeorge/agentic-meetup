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
 * Nine draw calls: sky, hills, path, pond, trunks, canopies, grass, stone, leaves.
 * About nineteen thousand triangles. The grass sways in its vertex shader and the
 * leaves drift in the frame loop, and nothing else moves.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PATH_WIDTH, type Garden } from './garden';
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
  stats(): { meshes: number; triangles: number };
  dispose(): void;
}

/** Heights are in scene units against an agent drawn about 0.24 tall (PERSON). */
/**
 * A blade is about a fifth of a person. At 0.11 -- half their height -- the grass
 * read as dark cards standing about the field rather than as grass (on the phone,
 * 2026-09-22).
 */
const GRASS_H = 0.044;
const GRASS_W = 0.022;
const TRUNK_H = 1.15;
// Barely off the ground, and BELOW the disc drawn under your own agent (0.02 x
// PERSON). At 0.006 the path was above it and swallowed the one marker that tells
// you which of the figures is yours (on the phone, 2026-09-22).
const PATH_Y = 0.0012;
const POND_Y = 0.0008;
const LEAVES = 130;
const HILL_FAR = 96;

interface Palette {
  skyTop: string; skyLow: string; hill: string; grass: string;
  path: string; pond: string; canopy: string; trunk: string; stone: string; leaf: string;
  wood: string; bush: string; reed: string;
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
};
const NIGHT: Palette = {
  skyTop: '#1E2740', skyLow: '#55597A', hill: '#3B4752', grass: '#465B45',
  path: '#6E6654', pond: '#37506B', canopy: '#3A5540', trunk: '#453A2E',
  stone: '#565C63', leaf: '#8A7440', sun: 0.4, ambient: 0.55,
  wood: '#544432', bush: '#31462E', reed: '#3A4E33',
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
function ground(radius: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(HILL_FAR * 2, HILL_FAR * 2, 44, 44);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
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

export function buildGarden(g: Garden, colors: GardenColors): BuiltGarden {
  const P = colors.night ? NIGHT : DAY;
  const group = new THREE.Group();
  // Built hidden. The city is what the Home screen opens on, and a garden that starts
  // visible is a green field drawn over the whole map until you first walk and come
  // back (on the phone, 2026-09-22).
  group.visible = false;
  const meshes: THREE.Mesh[] = [];
  const junk: { dispose(): void }[] = [];
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
    new THREE.SphereGeometry(HILL_FAR * 1.6, 18, 12),
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
  add(ground(g.radius), new THREE.MeshLambertMaterial({ color: mix(P.grass, P.hill, 0.3) }), 'ground');
  add(ribbon(g.path, PATH_WIDTH, PATH_Y), new THREE.MeshLambertMaterial({
    color: P.path, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  }), 'path');

  const pondMat = new THREE.MeshLambertMaterial({
    color: mix(P.pond, colors.accent, 0.12), transparent: true, opacity: 0.9, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    emissive: new THREE.Color(P.pond), emissiveIntensity: colors.night ? 0.3 : 0,
  });
  const waterParts = [fill(g.pond, POND_Y), fill(g.river, POND_Y)];
  const water = mergeGeometries(waterParts, false)!;
  for (const w of waterParts) w.dispose();
  add(water, pondMat, 'water');

  // Trees: a trunk and three canopy blobs, two draw calls for the lot.
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.055, 0.085, TRUNK_H, 5),
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
    group.add(m); meshes.push(m); junk.push(m.geometry, m.material as THREE.Material);
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
  const blades = g.tufts.length + g.reeds.length;
  const tufts = new THREE.InstancedMesh(tuftGeometry(), grassMat, Math.max(1, blades));
  g.tufts.forEach((t, i) => {
    dummy.position.set(t.x, 0, t.z);
    dummy.rotation.set(0, t.rot, 0);
    dummy.scale.set(t.scale, t.scale * (0.8 + (i % 5) * 0.1), t.scale);
    dummy.updateMatrix(); tufts.setMatrixAt(i, dummy.matrix);
    tufts.setColorAt(i, shade.set(P.grass).multiplyScalar(0.74 + ((i * 11) % 13) / 42));
  });
  g.reeds.forEach((r, k) => {
    const i = g.tufts.length + k;
    dummy.position.set(r.x, 0, r.z);
    dummy.rotation.set(0, r.rot, 0);
    dummy.scale.set(r.scale * 0.7, r.scale * 2.6, r.scale * 0.7);
    dummy.updateMatrix(); tufts.setMatrixAt(i, dummy.matrix);
    tufts.setColorAt(i, shade.set(P.reed).multiplyScalar(0.8 + ((k * 7) % 9) / 26));
  });
  tufts.name = 'grass'; tufts.frustumCulled = false; tufts.raycast = () => {};
  group.add(tufts); meshes.push(tufts); junk.push(tufts.geometry, grassMat);

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
  {
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
  if (g.benches.length) {
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
    // boulders with leaves (on the phone, 2026-09-22).
    const bushMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.15, 7, 5),
      new THREE.MeshLambertMaterial({ color: '#ffffff' }), g.bushes.length);
    g.bushes.forEach((b, i) => {
      dummy.position.set(b.x, 0.095 * b.scale, b.z);
      dummy.rotation.set(0, i * 1.1, 0);
      dummy.scale.set(b.scale, b.scale * 0.72, b.scale * 0.92);
      dummy.updateMatrix(); bushMesh.setMatrixAt(i, dummy.matrix);
      bushMesh.setColorAt(i, shade.set(P.bush).multiplyScalar(0.84 + ((i * 13) % 11) / 30));
    });
    bushMesh.name = 'bushes'; bushMesh.frustumCulled = false; bushMesh.raycast = () => {};
    group.add(bushMesh); meshes.push(bushMesh); junk.push(bushMesh.geometry, bushMesh.material as THREE.Material);
  }

  // Flowers, in beds. Normals up, like the grass, for the same reason.
  if (g.flowers.length) {
    const bloom = new THREE.InstancedMesh(
      tuftGeometry(), new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.FrontSide }), g.flowers.length);
    g.flowers.forEach((f, i) => {
      dummy.position.set(f.x, 0, f.z);
      dummy.rotation.set(0, i * 2.4, 0);
      dummy.scale.set(f.scale * 1.5, f.scale * 1.7, f.scale * 1.5);
      dummy.updateMatrix(); bloom.setMatrixAt(i, dummy.matrix);
      bloom.setColorAt(i, shade.set(BLOOMS[Math.floor(f.tint * BLOOMS.length) % BLOOMS.length]!));
    });
    bloom.name = 'flowers'; bloom.frustumCulled = false; bloom.raycast = () => {};
    group.add(bloom); meshes.push(bloom); junk.push(bloom.geometry, bloom.material as THREE.Material);
  }

  // Lanterns and rocks, merged into one piece of stone.
  const stone: THREE.BufferGeometry[] = [];
  for (const p of g.props) {
    if (p.kind === 'lantern') {
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

  // Leaves on the air. Few enough to write by hand each frame.
  const leafGeo = new THREE.PlaneGeometry(0.05, 0.035);
  const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshBasicMaterial({
    color: P.leaf, side: THREE.DoubleSide, transparent: true, opacity: 0.85,
  }), LEAVES);
  const drift = Array.from({ length: LEAVES }, (_, i) => ({
    x: (((i * 37) % 100) / 100 - 0.5) * g.radius * 1.6,
    z: (((i * 61) % 100) / 100 - 0.5) * g.radius * 1.6,
    y: ((i * 17) % 100) / 100,
    s: 0.4 + (((i * 23) % 70) / 100),
  }));
  leaves.name = 'leaves'; leaves.frustumCulled = false; leaves.raycast = () => {};
  group.add(leaves); meshes.push(leaves); junk.push(leafGeo, leaves.material as THREE.Material);

  const tick = (t: number, _dt: number) => {
    windTime.value = t;
    pondMat.opacity = 0.84 + 0.1 * (0.5 + 0.5 * Math.sin(t * (Math.PI / 2)));
    for (let i = 0; i < LEAVES; i++) {
      const d = drift[i]!;
      const fall = (d.y + t * 0.055 * d.s) % 1;
      dummy.position.set(
        d.x + Math.sin(t * 0.6 + i) * 0.5,
        2.4 * (1 - fall) + 0.05,
        d.z + Math.cos(t * 0.45 + i * 1.7) * 0.5,
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

  return {
    group, horizon, tick,
    stats: () => ({ meshes: meshes.length, triangles: Math.round(meshes.reduce((s, m) => s + tris(m), 0)) }),
    dispose: () => { for (const j of junk) j.dispose(); },
  };
}

/** The sky dome has to follow the camera, or you walk out from under it. */
export function skyFollow(built: BuiltGarden, x: number, y: number, z: number): void {
  const sky = built.group.children.find((c) => c.name === 'sky');
  if (sky) sky.position.set(x, y, z);
}
