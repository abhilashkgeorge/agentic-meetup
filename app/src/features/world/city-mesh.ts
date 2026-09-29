/**
 * The city round Cubbon Park, drawn: the road outside the fence with its dashed middle
 * line, the pavements, the buildings across the road with their windows and shop
 * boards, and the traffic (the plan is city-plan.ts, the traffic's motion traffic.ts).
 *
 * WHAT IT COSTS. The ground is three meshes. The buildings are cut into squares of
 * CHUNK units, one mesh a square, and a square past the mist is switched off (`cull`),
 * as the park's own trees are. Windows are a texture, not geometry: a wall's UVs count
 * bays and storeys, so a tower costs the same twelve triangles as a shed. The traffic is
 * one instanced mesh per kind of vehicle -- five draws -- holding only the vehicles near
 * the camera.
 *
 * Nothing here can be walked into: the park's fence (MapSpots.bounds) keeps everybody
 * in the park.
 *
 * Reached only through canvas.tsx, like the other files that import three.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VIEW } from './camera';
import { FACADES, SIGNS, cornersOf, type CityPlan } from './city-plan';
import type { Pt } from './sim';
import { Traffic, type VehicleKind } from './traffic';
import { LIVERIES, vehicleGeometry } from './vehicle-mesh';

export interface BuiltCity {
  group: THREE.Group;
  /** Move the traffic on and put the vehicles near (x, z) in their meshes. */
  tick(dt: number, x: number, z: number): void;
  /** Switch off the squares of buildings past the mist from (x, z). */
  cull(x: number, z: number): void;
  readonly traffic: Traffic;
  stats(): { buildings: number; vehicles: number };
  dispose(): void;
}

/**
 * Squares of the city, in units, each ONE mesh -- its buildings and their shop boards
 * together, one draw. At 24 units and a mesh for the boards beside each, the city was
 * thirty-odd draws from anywhere near the fence; the phone pays for every one of them
 * on its JavaScript side before the graphics chip sees it.
 */
const CHUNK = 40;
/** A storey and a bay of windows, in units: 3.5 m and 2.8 m. */
const STOREY = 0.43;
const BAY = 0.35;
/** Heights off the ground, so nothing flickers against what it lies on. */
const ROAD_Y = 0.0016;
const PAVEMENT_Y = 0.0022;
const LINE_Y = 0.0028;

const DAY = { road: '#55575C', pavement: '#BDB7AA', line: '#F1F1EC', window: '#3B4450' };
const NIGHT = { road: '#26282C', pavement: '#4A4741', line: '#8D8D86', window: '#E8C877' };

/** Rings with holes, as flat triangles at `y`. */
function flat(rings: CityPlan['road'], y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const { outer, holes } of rings) {
    const v2 = (p: Pt) => new THREE.Vector2(p[0], p[1]);
    const contour = outer.map(v2), holeV = holes.map((h) => h.map(v2));
    const tris = THREE.ShapeUtils.triangulateShape(contour, holeV);
    const all = [...contour, ...holeV.flat()];
    for (const [a, b, c] of tris) {
      // Wound to face up (the plan's rings run either way round).
      const pa = all[a]!, pb = all[b]!, pc = all[c]!;
      const up = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x) < 0;
      for (const p of up ? [pa, pb, pc] : [pa, pc, pb]) pos.push(p.x, y, p.y);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** The dashed middle line: 2.8 m of paint every 7 m, 12 cm wide. */
function dashes(lines: readonly Pt[][]): THREE.BufferGeometry {
  const DASH = 0.35, EVERY = 0.86, W = 0.015;
  const pos: number[] = [];
  for (const line of lines) {
    let carry = 0;
    for (let i = 0; i < line.length; i++) {
      const a = line[i]!, b = line[(i + 1) % line.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) continue;
      const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
      const nx = dz * W, nz = -dx * W;
      for (let s = carry; s < len; s += EVERY) {
        const e = Math.min(len, s + DASH);
        const p0: Pt = [a[0] + dx * s, a[1] + dz * s], p1: Pt = [a[0] + dx * e, a[1] + dz * e];
        pos.push(p0[0] - nx, LINE_Y, p0[1] - nz, p1[0] - nx, LINE_Y, p1[1] - nz, p1[0] + nx, LINE_Y, p1[1] + nz);
        pos.push(p0[0] - nx, LINE_Y, p0[1] - nz, p1[0] + nx, LINE_Y, p1[1] + nz, p0[0] + nx, LINE_Y, p0[1] + nz);
      }
      carry = ((carry - len) % EVERY + EVERY) % EVERY;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * The windows: a wall-coloured tile with one dark pane, repeated by bay and storey.
 * White, so the wall's own colour (in its vertices) shows through; the pane is dark by
 * day and lit by night.
 */
function windowTexture(pane: string): THREE.DataTexture {
  const N = 16;
  const data = new Uint8Array(N * N * 4).fill(255);
  const c = new THREE.Color(pane);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (x >= 4 && x < 12 && y >= 5 && y < 13) {
        const i = (y * N + x) * 4;
        data[i] = Math.round(c.r * 255); data[i + 1] = Math.round(c.g * 255); data[i + 2] = Math.round(c.b * 255);
      }
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** One building's walls and roof, with UVs counting bays and storeys and its colour in its vertices. */
function buildingGeometry(b: CityPlan['buildings'][number]): THREE.BufferGeometry {
  const cs = cornersOf(b);
  const col = new THREE.Color(FACADES[b.col] ?? FACADES[0]);
  const roof = col.clone().multiplyScalar(0.82);
  const pos: number[] = [], uv: number[] = [], rgb: number[] = [], idx: number[] = [];
  const quad = (p: number[][], u: number[][], c: THREE.Color) => {
    const at = pos.length / 3;
    for (let k = 0; k < 4; k++) { pos.push(...p[k]!); uv.push(...u[k]!); rgb.push(c.r, c.g, c.b); }
    idx.push(at, at + 1, at + 2, at, at + 2, at + 3);
  };
  for (let i = 0; i < 4; i++) {
    const a = cs[i]!, c = cs[(i + 1) % 4]!;
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const u1 = Math.max(1, Math.round(len / BAY)), v1 = b.h / STOREY;
    // Wound so the wall faces out: corners run clockwise seen from above.
    quad([[c[0], 0, c[1]], [a[0], 0, a[1]], [a[0], b.h, a[1]], [c[0], b.h, c[1]]], [[u1, 0], [0, 0], [0, v1], [u1, v1]], col);
  }
  // The roof takes the tile's plain corner, so no window is drawn on it.
  quad([[cs[0]![0], b.h, cs[0]![1]], [cs[3]![0], b.h, cs[3]![1]], [cs[2]![0], b.h, cs[2]![1]], [cs[1]![0], b.h, cs[1]![1]]],
    [[0.02, 0.02], [0.02, 0.02], [0.02, 0.02], [0.02, 0.02]], roof);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(rgb, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/**
 * A shop's board over its ground floor, on the side facing the road. Drawn with the
 * walls, in one mesh: its UVs are the window tile's plain corner, so no window is drawn
 * on it, and its colour is in its vertices like the walls'.
 */
function signGeometry(b: CityPlan['buildings'][number]): THREE.BufferGeometry | null {
  if (b.sign < 0) return null;
  const box = new THREE.BoxGeometry(b.w * 0.8, 0.07, 0.012);
  const g = box.toNonIndexed();
  box.dispose();
  const uv = g.attributes.uv!;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.02, 0.02);
  // On the front wall (its +z, which is the facing), three metres up.
  g.translate(0, 0.37, b.d / 2 + 0.006);
  g.rotateY(b.a);
  g.translate(b.c[0], 0, b.c[1]);
  const c = new THREE.Color(SIGNS[b.sign] ?? SIGNS[0]);
  const n = g.attributes.position!.count;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { rgb[i * 3] = c.r; rgb[i * 3 + 1] = c.g; rgb[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  return g;
}

/** How many of each kind of vehicle's mesh can hold: all of them, near the camera or not. */
const KINDS: readonly (VehicleKind | 'auto-black')[] = ['bike', 'auto', 'auto-black', 'car', 'bus'];

export function buildCity(plan: CityPlan, colors: { night: boolean }): BuiltCity {
  const P = colors.night ? NIGHT : DAY;
  const group = new THREE.Group();
  group.name = 'city';
  const junk: { dispose(): void }[] = [];
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name; m.raycast = () => {};
    group.add(m); junk.push(geo, mat);
    return m;
  };

  // The ground: road, pavements and the line down the middle. Each lies over the
  // city's dusty ground (garden-mesh.ts) and none may flicker against it.
  const lifted = (color: string, k: number) => new THREE.MeshLambertMaterial({
    color, polygonOffset: true, polygonOffsetFactor: -k, polygonOffsetUnits: -k * 2,
  });
  add(flat(plan.road, ROAD_Y), lifted(P.road, 1), 'city-road').frustumCulled = false;
  add(flat(plan.pavement, PAVEMENT_Y), lifted(P.pavement, 1), 'city-pavement').frustumCulled = false;
  add(dashes(plan.centre), lifted(P.line, 2), 'city-lines').frustumCulled = false;

  // The buildings, a square at a time.
  const tex = windowTexture(P.window);
  const walls = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex });
  junk.push(tex, walls);
  const squares = new Map<string, CityPlan['buildings']>();
  for (const b of plan.buildings) {
    const k = `${Math.floor(b.c[0] / CHUNK)},${Math.floor(b.c[1] / CHUNK)}`;
    const at = squares.get(k);
    if (at) at.push(b); else squares.set(k, [b]);
  }
  const chunks: { meshes: THREE.Mesh[]; x: number; z: number; r: number }[] = [];
  for (const list of squares.values()) {
    const parts = [...list.map(buildingGeometry), ...list.map(signGeometry).filter((g): g is THREE.BufferGeometry => g !== null)];
    const geo = mergeGeometries(parts, false)!;
    for (const p of parts) p.dispose();
    geo.computeBoundingSphere();
    const s = geo.boundingSphere!;
    chunks.push({ meshes: [add(geo, walls, 'city-buildings')], x: s.center.x, z: s.center.z, r: s.radius });
  }

  // The traffic.
  const traffic = new Traffic(plan.lanes.map((l) => l.loop));
  const fleet = KINDS.map((kind) => {
    const geo = vehicleGeometry(kind);
    const count = traffic.vehicles.filter((v) => (kind === 'auto-black' ? v.kind === 'auto' : v.kind === kind)).length;
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), Math.max(1, count));
    mesh.name = `traffic-${kind}`;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    // Its count changes every frame: a sphere three computed once would be wrong for
    // good (tests/canvas-size.test.ts). Nothing culls or taps these by it anyway.
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    group.add(mesh); junk.push(geo, mesh.material as THREE.Material);
    return { kind, mesh };
  });
  const dummy = new THREE.Object3D();
  const REACH = VIEW + 4;
  // Each vehicle's mesh and paint, worked out once: parsing a colour and finding a mesh
  // for every vehicle every frame was most of the city's cost on the phone.
  const meshOf = traffic.vehicles.map((v) => {
    // Half the autos are black under the canopy, half green: by the vehicle's seed.
    const kind = v.kind === 'auto' && v.seed % 2 === 0 ? 'auto-black' : v.kind;
    return fleet.find((q) => q.kind === kind)!.mesh;
  });
  const paintOf = traffic.vehicles.map((v) => new THREE.Color(LIVERIES[v.kind][v.seed % LIVERIES[v.kind].length]!));
  const near = { x: 0, z: 0, r: REACH };

  return {
    group,
    traffic,
    tick(dt, x, z) {
      near.x = x; near.z = z;
      traffic.step(dt, near);
      for (const f of fleet) f.mesh.count = 0;
      const vs = traffic.vehicles;
      for (let k = 0; k < vs.length; k++) {
        const v = vs[k]!;
        if ((v.x - x) * (v.x - x) + (v.z - z) * (v.z - z) > REACH * REACH) continue;
        const mesh = meshOf[k]!;
        dummy.position.set(v.x, 0, v.z);
        dummy.rotation.set(0, v.facing, 0);
        dummy.updateMatrix();
        const i = mesh.count++;
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, paintOf[k]!);
      }
      for (const f of fleet) {
        f.mesh.instanceMatrix.needsUpdate = true;
        if (f.mesh.instanceColor) f.mesh.instanceColor.needsUpdate = true;
      }
    },
    cull(x, z) {
      for (const c of chunks) {
        const on = Math.hypot(c.x - x, c.z - z) - c.r < VIEW;
        for (const m of c.meshes) m.visible = on;
      }
    },
    stats: () => ({
      buildings: plan.buildings.length,
      vehicles: fleet.reduce((n, f) => n + f.mesh.count, 0),
    }),
    dispose() {
      for (const j of junk) j.dispose();
      group.clear();
    },
  };
}
