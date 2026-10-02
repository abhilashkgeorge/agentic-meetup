/**
 * Everything in the park at its size beside the people in it.
 *
 * WHAT THE FOUNDER ASKED (2026-09-29): "fix scale too wrt to park bench cycle and
 * everything else". Measured before, at 8.1 m a unit: a bench's seat 0.66 m off the
 * ground where a sitting person's seat is 0.38 m -- everybody on a bench sat 28 cm
 * inside it -- the bench 2.25 m long with a back 1.3 m high, a table top at 1.08 m,
 * grass up to 1.03 m, bushes 1.2 to 2.5 m, flowers to 73 cm.
 *
 * WHAT IS PINNED, all of it measured from what is drawn -- the real GLB at the matrix
 * the furniture is drawn with, the real rig through the baked sitting pose, the
 * garden's own instanced meshes -- and never from a constant restated here:
 *   - a person is 1.6 to 1.9 m;
 *   - a bench's seat is where a sitting person's seat is, within 2 cm; the two of a
 *     pair sit side by side on it without overlapping and without hanging off an end;
 *     a sitting back is in front of the backrest, within 8 cm of it;
 *   - walking straight at a bench stops you within 25 cm of its seat, and never
 *     inside it or through its backrest;
 *   - a bench 1.3 to 1.9 m long with a back 0.65 to 1.0 m high; a table top 0.65 to
 *     0.85 m; a bin 0.8 to 1.1 m; a lamp 3 to 5 m;
 *   - grass no taller than half a metre and mostly 15 to 35 cm; flowers under 60 cm;
 *     bushes 0.6 to 1.8 m;
 *   - the car 3.6 to 4.6 m long and 1.4 to 1.7 m high; the traffic beyond the fence
 *     at its own sizes -- two-wheeler and rider, auto, bus;
 *   - the fence 1.2 to 2 m high, below a person's shoulder;
 *   - a footpath 2.5 to 4 m wide, a road 5 to 8 m.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - the bench back at the old shared 0.16          -> "sits on the seat" fails
 *   - SEAT back at 0.068                             -> "side by side" fails (off the ends)
 *   - the seat 0.012 in front of the middle again    -> "in front of the backrest" fails
 *   - grass at the old 1.5                           -> "grass" fails
 *   - BUSH_SIZE at the old 0.15                      -> "bushes" fails
 *   - one bench collider of 0.11 again               -> "walking up to a bench" fails
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PERSON } from '../src/features/world/camera';
import { MODEL_SCALE } from '../src/features/world/character-mesh';
import { CUBBON_PATH_W, CUBBON_ROAD_W, METRES_PER_UNIT as M } from '../src/features/world/cubbon';
import { buildCar } from '../src/features/world/car-mesh';
import { BIKE } from '../src/features/world/bike';
import { buildBike } from '../src/features/world/bike-mesh';
import { buildAuto, buildBus, buildTwoWheeler } from '../src/features/world/vehicle-mesh';
import { buildGarden } from '../src/features/world/garden-mesh';
import { gardenSpots } from '../src/features/world/garden';
import { WorldSim } from '../src/features/world/sim';
import { seatOn } from '../src/features/world/bench';
import { CUBBON_PARK, venueGarden } from '../src/features/world/venue';
import { makeVenueFurniture, type FurnitureKind } from '../src/features/world/venue-mesh';
import type * as Gpu from '../src/features/world/crowd-gpu';

type Ctor = { new (type: string, init?: Record<string, unknown>): Event };
(globalThis as Record<string, unknown>).ProgressEvent ??= class extends Event {
  constructor(type: string, init: Record<string, unknown> = {}) { super(type); Object.assign(this, init); }
} as unknown as Ctor;

const ASSETS = join(import.meta.dirname, '..', 'assets');
type Gltf = { scene: THREE.Object3D; animations: THREE.AnimationClip[] };
const load = (path: string) => {
  const b = readFileSync(path);
  return new Promise<Gltf>((res, rej) =>
    new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res as never, rej));
};

const park = venueGarden(CUBBON_PARK);
/** World units per unit of the character model: what the crowd draws a person at. */
const K = MODEL_SCALE * PERSON;

/** The furniture GLB's own geometry by kind, and the matrix each kind is drawn with. */
const MESH: Record<FurnitureKind, string> = {
  bench: 'ParkFurn_Bench_A', lamp: 'ParkFurn_Lamp_A', bin: 'ParkFurn_TrashCan_C', table: 'ParkFurn_Table_I',
};
const geometry = {} as Record<FurnitureKind, THREE.BufferGeometry>;
const drawnScale = {} as Record<FurnitureKind, THREE.Vector3>;

/** What a person sitting is, from the baked pose: GLB units of the rig. */
let sitting: { seat: number; back: number; half: number };
let standing: number;

beforeAll(async () => {
  const furniture = await load(join(ASSETS, 'venues', 'cubbon-park', 'furniture.glb'));
  furniture.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    for (const k of Object.keys(MESH) as FurnitureKind[]) if (mesh.isMesh && mesh.name === MESH[k]) geometry[k] = mesh.geometry;
  });
  const manifest = JSON.parse(readFileSync(join(ASSETS, 'venues', 'cubbon-park', 'manifest.json'), 'utf8'));
  const built = makeVenueFurniture(furniture, manifest, park);
  // Stand beside one of each and read the matrix its detailed model is drawn with:
  // the nearest of each kind is its mesh's first instance.
  const first: Record<FurnitureKind, { x: number; z: number }> = {
    bench: park.benches[0]!,
    lamp: park.props.find((p) => p.kind === 'lantern')!,
    bin: { x: park.benches[0]!.x, z: park.benches[0]!.z },
    table: park.path[Math.floor(park.path.length * 0.28)]
      ? { x: park.path[Math.floor(park.path.length * 0.28)]![0] + 1.2, z: park.path[Math.floor(park.path.length * 0.28)]![1] - 0.8 }
      : { x: 0, z: 0 },
  };
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3(), q = new THREE.Quaternion();
  for (const kind of Object.keys(MESH) as FurnitureKind[]) {
    built.follow(first[kind].x + 500, first[kind].z);   // somewhere else first: follow skips small moves
    built.follow(first[kind].x, first[kind].z);
    const mesh = built.group.children.find((c) => c.name === `venue-${kind}-detailed`) as THREE.InstancedMesh;
    expect(mesh.count, `no ${kind} drawn near one`).toBeGreaterThan(0);
    mesh.getMatrixAt(0, m);
    drawnScale[kind] = new THREE.Vector3();
    m.decompose(pos, q, drawnScale[kind]);
  }

  // The rig, sitting: the seat of the trousers, the small of the back, the elbows.
  const gpu: typeof Gpu = await import('../src/features/world/crowd-gpu');
  const rig = await load(join(ASSETS, 'characters', 'people.glb'));
  const meshes: THREE.SkinnedMesh[] = [];
  rig.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  const names = meshes[0]!.skeleton.bones.map((b) => b.name);
  const bake = gpu.bakeClips(rig.scene, names, meshes[0]!.skeleton.boneInverses, new Map(rig.animations.map((c) => [c.name, c])));
  const idx = (n: string) => names.indexOf(n);
  const seatBones = new Set(['Hips', 'Body', 'UpperLegL', 'UpperLegR'].map(idx));
  const backBones = new Set(['Hips', 'Body', 'Abdomen', 'Torso', 'Chest'].map(idx));
  let seat = Infinity, back = Infinity, half = 0, top = 0;
  const v = new THREE.Vector3();
  for (const mesh of meshes.filter((x) => x.name.startsWith('m_casual_2_'))) {
    const p = mesh.geometry.attributes.position!, si = mesh.geometry.attributes.skinIndex!, sw = mesh.geometry.attributes.skinWeight!;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p as THREE.BufferAttribute, i);
      top = Math.max(top, v.y);
      const ix = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)];
      const w = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)];
      const main = ix[w.indexOf(Math.max(...w))]!;
      const at = gpu.skinFromBake(bake, bake.sit.row, ix, w, v);
      if (seatBones.has(main)) seat = Math.min(seat, at.y);
      if (backBones.has(main)) back = Math.min(back, at.z);
      half = Math.max(half, Math.abs(at.x));
    }
  }
  sitting = { seat, back, half };
  standing = top;
});

/** The GLB's own numbers for a kind: its box, and for a bench its seat and backrest. */
function shape(kind: FurnitureKind) {
  const g = geometry[kind];
  g.computeBoundingBox();
  const box = g.boundingBox!;
  const p = g.attributes.position!;
  // The seat: the highest point in the front half, away from the backrest at -z.
  let seat = -Infinity;
  for (let i = 0; i < p.count; i++) if (p.getZ(i) > 0) seat = Math.max(seat, p.getY(i));
  // The backrest's front face: the furthest forward of everything well above the seat.
  let backrest = -Infinity;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > seat + 0.15) backrest = Math.max(backrest, p.getZ(i));
  return { box, seat, backrest };
}

describe('the people', () => {
  it('are 1.6 to 1.9 m tall', () => {
    const m = standing * K * M;
    expect(m).toBeGreaterThan(1.6);
    expect(m).toBeLessThan(1.9);
  });
});

describe('a bench', () => {
  it('sits on the seat: the seat is where a sitting person\'s seat is', () => {
    const b = shape('bench');
    const seatTop = b.seat * drawnScale.bench.y * M;
    const person = sitting.seat * K * M;
    expect(Math.abs(seatTop - person), `the seat is at ${seatTop.toFixed(2)} m and a sitting person's at ${person.toFixed(2)} m`)
      .toBeLessThan(0.02);
  });

  it('seats two side by side, not overlapping and not off the ends', () => {
    const b = shape('bench');
    const halfLength = ((b.box.max.x - b.box.min.x) / 2) * drawnScale.bench.x * M;
    const left = seatOn({ x: 0, z: 0, rot: 0 }, true);
    const along = Math.abs(left.x) * M;                     // from the middle, each way
    const elbows = sitting.half * K * M;
    expect(along - elbows, 'the two sit inside each other').toBeGreaterThan(0.002);
    expect(along + elbows, 'somebody hangs off the end of the bench').toBeLessThan(halfLength + 0.03);
  });

  it('puts a sitting back in front of the backrest, and close to it', () => {
    const b = shape('bench');
    const seat = seatOn({ x: 0, z: 0, rot: 0 }, true);
    const backrest = b.backrest * drawnScale.bench.z * M;
    const back = seat.z * M + sitting.back * K * M;
    const gap = back - backrest;
    expect(gap, 'sitting inside the backrest').toBeGreaterThan(0);
    expect(gap, `sitting ${gap.toFixed(2)} m forward of the backrest`).toBeLessThan(0.08);
  });

  it('is a park bench: 1.3 to 1.9 m long, the back 0.65 to 1.0 m high', () => {
    const b = shape('bench');
    const length = (b.box.max.x - b.box.min.x) * drawnScale.bench.x * M;
    const high = b.box.max.y * drawnScale.bench.y * M;
    expect(length).toBeGreaterThan(1.3); expect(length).toBeLessThan(1.9);
    expect(high).toBeGreaterThan(0.65); expect(high).toBeLessThan(1.0);
  });
});

describe('walking up to a bench', () => {
  it('stops you at its front, not most of a metre short of it, and not in it', () => {
    const sim = new WorldSim(1);
    sim.setMap(gardenSpots(park));
    const b = shape('bench');
    const front = b.box.max.z * drawnScale.bench.z;          // the seat's front edge, units
    const back = b.box.min.z * drawnScale.bench.z;
    let checked = 0;
    for (const bench of park.benches.slice(0, 40)) {
      const fx = Math.sin(bench.rot), fz = Math.cos(bench.rot);
      // From a metre and a half out, straight at the middle of the seat.
      let d = 0.2;
      while (d > 0 && sim.standable(bench.x + fx * d, bench.z + fz * d)) d -= 0.001;
      if (d >= 0.2) continue;                                   // something else is in front of it
      checked++;
      const air = (d - front) * M;
      expect(air, `a bench stops you ${air.toFixed(2)} m off its seat`).toBeLessThan(0.25);
      expect(d, 'walked into the bench').toBeGreaterThan(front);
      // And from behind, the backrest stops you too.
      expect(sim.standable(bench.x + fx * (back - 0.001), bench.z + fz * (back - 0.001)), 'walked through the backrest').toBe(false);
    }
    expect(checked, 'no bench could be walked up to, so this proves nothing').toBeGreaterThan(20);
  });
});

describe('the rest of the furniture', () => {
  const heightOf = (kind: FurnitureKind) => shape(kind).box.max.y * drawnScale[kind].y * M;
  it('a table top 0.65 to 0.85 m, a bin 0.8 to 1.1 m, a lamp 3 to 5 m', () => {
    expect(heightOf('table')).toBeGreaterThan(0.65); expect(heightOf('table')).toBeLessThan(0.85);
    expect(heightOf('bin')).toBeGreaterThan(0.8); expect(heightOf('bin')).toBeLessThan(1.1);
    expect(heightOf('lamp')).toBeGreaterThan(3); expect(heightOf('lamp')).toBeLessThan(5);
  });
});

describe('what grows', () => {
  const built = buildGarden(park, { night: false, accent: '#6c5ce7' });
  const tops = (mesh: THREE.InstancedMesh, skip?: (x: number, z: number) => boolean) => {
    const geo = mesh.geometry;
    geo.computeBoundingBox();
    const corners = [geo.boundingBox!.min, geo.boundingBox!.max];
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const out: number[] = [];
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      const x = m.elements[12]!, z = m.elements[14]!;
      if (skip?.(x, z)) continue;
      let top = -Infinity;
      for (const a of corners) for (const b of corners) for (const c of corners) {
        top = Math.max(top, v.set(a.x, b.y, c.z).applyMatrix4(m).y);
      }
      out.push(top * M);
    }
    return out.sort((a, b) => a - b);
  };
  const reeds = new Set(park.reeds.map((r) => `${r.x.toFixed(4)},${r.z.toFixed(4)}`));
  const isReed = (x: number, z: number) => reeds.has(`${x.toFixed(4)},${z.toFixed(4)}`);

  it('grass: no taller than half a metre, and mostly 15 to 35 cm', () => {
    const blades = built.group.children.filter((c) => c.name === 'grass')
      .flatMap((c) => tops(c as THREE.InstancedMesh, isReed));
    expect(blades.length).toBeGreaterThan(10_000);
    expect(blades[blades.length - 1]!, 'the tallest blade').toBeLessThan(0.5);
    const middle = blades[Math.floor(blades.length / 2)]!;
    expect(middle).toBeGreaterThan(0.15); expect(middle).toBeLessThan(0.35);
  });

  it('flowers under 60 cm; bushes 0.6 to 1.8 m', () => {
    const flowers = tops(built.group.children.find((c) => c.name === 'flowers') as THREE.InstancedMesh);
    expect(flowers[flowers.length - 1]!).toBeLessThan(0.6);
    const bushes = tops(built.group.children.find((c) => c.name === 'bushes') as THREE.InstancedMesh);
    expect(bushes[0]!, 'the smallest bush').toBeGreaterThan(0.6);
    expect(bushes[bushes.length - 1]!, 'the biggest bush').toBeLessThan(1.8);
  });
});

describe('the fence, and the traffic beyond it', () => {
  const tall = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); return g.boundingBox!; };
  it('a railing 1.2 to 2 m high, below a person\'s shoulder, so the city shows over it', () => {
    const built = buildGarden(park, { night: false, accent: '#6c5ce7' }, { city: true });
    const fence = built.group.children.find((c) => c.name === 'fence') as THREE.Mesh;
    const h = tall(fence.geometry).max.y * M;
    expect(h).toBeGreaterThan(1.2); expect(h).toBeLessThan(2.0);
    expect(h, 'taller than the people').toBeLessThan(standing * K * M);
    built.dispose();
  });

  it('a two-wheeler 1.7 to 2.1 m long, its rider\'s helmet 1.4 to 1.8 m up; an auto 2.4 to 3 m; a bus 10 to 12.5 m and 2.9 to 3.4 m high', () => {
    const bike = tall(buildTwoWheeler()), auto = tall(buildAuto('#2E7D32')), bus = tall(buildBus());
    const long = (b: THREE.Box3) => (b.max.z - b.min.z) * M;
    expect(long(bike)).toBeGreaterThan(1.7); expect(long(bike)).toBeLessThan(2.1);
    expect(bike.max.y * M).toBeGreaterThan(1.4); expect(bike.max.y * M).toBeLessThan(1.8);
    expect(long(auto)).toBeGreaterThan(2.4); expect(long(auto)).toBeLessThan(3.0);
    expect(long(bus)).toBeGreaterThan(10); expect(long(bus)).toBeLessThan(12.5);
    expect(bus.max.y * M).toBeGreaterThan(2.9); expect(bus.max.y * M).toBeLessThan(3.4);
  });
});

describe('a bicycle', () => {
  it('is a bicycle\'s size: 1.45 to 1.9 m long, wheels 0.55 to 0.72 m across, its saddle 0.75 to 1 m up', () => {
    const b = buildBike();
    b.computeBoundingBox();
    const box = b.boundingBox!;
    expect((box.max.z - box.min.z) * K * M).toBeGreaterThan(1.45);
    expect((box.max.z - box.min.z) * K * M).toBeLessThan(1.9);
    expect(BIKE.wheelR * 2 * K * M).toBeGreaterThan(0.55);
    expect(BIKE.wheelR * 2 * K * M).toBeLessThan(0.72);
    expect(BIKE.saddle[1] * K * M).toBeGreaterThan(0.75);
    expect(BIKE.saddle[1] * K * M).toBeLessThan(1.0);
    // Its wheels on the ground.
    expect(box.min.y).toBeCloseTo(0, 2);
  });
});

describe('the car, and the paths', () => {
  it('the car is a small hatchback: 3.6 to 4.6 m long, 1.4 to 1.7 m high', () => {
    const car = buildCar('#6c5ce7');
    car.computeBoundingBox();
    const b = car.boundingBox!;
    expect((b.max.z - b.min.z) * M).toBeGreaterThan(3.6); expect((b.max.z - b.min.z) * M).toBeLessThan(4.6);
    expect(b.max.y * M).toBeGreaterThan(1.4); expect(b.max.y * M).toBeLessThan(1.7);
  });

  it('a footpath is 2.5 to 4 m wide and a road 5 to 8 m', () => {
    expect(CUBBON_PATH_W * M).toBeGreaterThan(2.5); expect(CUBBON_PATH_W * M).toBeLessThan(4);
    expect(CUBBON_ROAD_W * M).toBeGreaterThan(5); expect(CUBBON_ROAD_W * M).toBeLessThan(8);
    const widths = new Set(park.paths.map((p) => p.width));
    expect([...widths].sort()).toEqual([CUBBON_PATH_W, CUBBON_ROAD_W].sort());
  });
});
