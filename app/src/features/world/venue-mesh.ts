/**
 * The authored detail in Cubbon Park: benches, lamps, bins and two tables.
 *
 * Garden terrain remains procedural and cheap. Furniture comes from a bundled CC0
 * GLB, but the GLB is a LIBRARY, not a scene: four selected source meshes become four
 * InstancedMeshes no matter how many benches and lamps the venue contains.
 *
 * DETAILED NEAR, SIMPLE FAR (the founder, 2026-09-28: "fix the park furniture").
 *
 * WHAT WAS WRONG. Every piece in the park was drawn with the detailed model, all the
 * time, and the whole set was checked against a budget made for the old 26-unit
 * garden. Once the park became the real one (2026-09-23) it held 180 benches, 175
 * lamps and 60 bins -- 257,558 triangles against a budget of 20,000 -- so the check
 * threw, the park fell back, and because the garden leaves its own benches and lamps
 * out when these are expected, the park had had no benches and no lamps at all since.
 * The test that guarded the budget built the OLD garden, so it went on passing.
 *
 * NOW: only the nearest pieces get the detailed model, nearest first, while they are
 * inside NEAR and the detailed triangles stay inside the manifest's budget. Everything
 * else out to FAR -- where the park's mist is total -- is a plain grey stand-in of a
 * few boxes, the same size and colour as the model, which is all a bench is through
 * the haze. Past FAR, nothing. The choice is redone when the camera has moved RESORT,
 * which at walking pace is about once a second, and costs one sort of 417 numbers.
 *
 * Reached only through canvas.tsx and therefore listed in LAZY_ONLY beside the other
 * files that import three/native modules.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VIEW } from './camera';
import type { Garden } from './garden';

interface Manifest {
  license: string;
  source: string;
  runtime: { meshes: string[]; maxDrawCalls: number; maxTriangles: number };
}

export interface BuiltVenueFurniture {
  group: THREE.Group;
  /** Where the camera stands, on the ground. Cheap to call every frame. */
  follow(x: number, z: number): void;
  /** What is drawn right now: meshes with anything in them, and their triangles. */
  stats(): { meshes: number; triangles: number };
  dispose(): void;
}

/**
 * How close a piece has to be for the detailed model. The mist starts at MIST_NEAR
 * (camera.ts, 10 units), so the change from model to stand-in happens where it is
 * already softening both; and at this radius the park's densest stretch still fits
 * the budget, which the nearest-first order enforces anyway.
 */
export const NEAR = 24;
/**
 * Past the end of the mist nothing is drawn at all (VIEW, camera.ts). It was 90, the
 * old far plane: 175 lamps and 180 benches drawn where nobody could see them.
 */
export const FAR = VIEW;
/** How far the camera moves before the choice is made again. */
const RESORT = 1;

export type FurnitureKind = 'bench' | 'lamp' | 'bin' | 'table';
export const KINDS: readonly FurnitureKind[] = ['bench', 'lamp', 'bin', 'table'];
const MESH_OF: Record<FurnitureKind, string> = {
  bench: 'ParkFurn_Bench_A', lamp: 'ParkFurn_Lamp_A', bin: 'ParkFurn_TrashCan_C', table: 'ParkFurn_Table_I',
};

export interface Piece { kind: FurnitureKind; x: number; z: number; rot: number; scale: number }

/**
 * HOW BIG EACH KIND IS DRAWN: world units per unit of the GLB, along its length (x),
 * its height (y) and its depth (z). The library is authored about six times too big,
 * and every kind used to share one number, 0.16 -- the people's own PERSON -- as if the
 * furniture had been made against the same figure. It was not (the founder,
 * 2026-09-29: "fix scale too wrt to park bench cycle and everything else").
 *
 * WHAT WAS WRONG, measured on the real GLB and the real rig at 8.1 m a unit
 * (tests/park-scale.test.ts): a bench's seat stood 0.66 m off the ground, and a person
 * sitting -- sitPose -- has the seat of their trousers at 0.38 m, so everybody on a
 * bench sat 28 cm inside it. The bench was 2.25 m long with a back 1.3 m high, and the
 * table's top was at 1.08 m, chest high on a person 1.75 m tall.
 *
 * NOW each kind is sized against what a person does with it:
 *   - a BENCH's seat is where a sitting person's seat is: the GLB's seat top is 0.505
 *     of its units and the rig's sitting seat 0.402 of its own, so 0.402 x the
 *     person's scale / 0.505. Stretched a fifth along its length, so the two of a pair
 *     sit side by side without hanging off the ends (SEAT in ride.ts): 1.55 m long,
 *     the back 0.77 m high;
 *   - a TABLE's top at 0.75 m;
 *   - a LAMP at 4.0 m and a BIN at 0.95 m, which they already were.
 */
export const SIZE: Readonly<Record<FurnitureKind, readonly [number, number, number]>> = {
  bench: [0.11, 0.0917, 0.0917],
  lamp: [0.16, 0.16, 0.16],
  bin: [0.16, 0.16, 0.16],
  table: [0.111, 0.111, 0.111],
};
/** The one size the stand-ins below were measured at (the old shared scale). */
const MEASURED_AT = 0.16;

/** Every piece of furniture in the park, from its layout. Pure, so a test can count it. */
export function furniturePieces(garden: Garden): Piece[] {
  const out: Piece[] = [];
  for (const b of garden.benches) out.push({ kind: 'bench', x: b.x, z: b.z, rot: b.rot, scale: 1 });
  for (const p of garden.props) {
    if (p.kind === 'lantern') out.push({ kind: 'lamp', x: p.x, z: p.z, rot: p.rot, scale: 1 });
  }
  garden.benches.forEach((b, i) => {
    if (i % 3 !== 0) return;
    out.push({ kind: 'bin', x: b.x + Math.cos(b.rot) * 0.35, z: b.z - Math.sin(b.rot) * 0.35, rot: b.rot, scale: 0.9 });
  });
  if (garden.path.length) {
    const pathAt = (t: number) => garden.path[Math.min(garden.path.length - 1, Math.floor(t * garden.path.length))]!;
    [0.28, 0.68].forEach((t, i) => {
      const p = pathAt(t);
      out.push({ kind: 'table', x: p[0] + (i ? -1.2 : 1.2), z: p[1] + (i ? 0.8 : -0.8), rot: i * 1.7, scale: 1 });
    });
  }
  return out;
}

/**
 * Which pieces get the detailed model and which the stand-in, seen from (x, z):
 * nearest first; detailed while inside NEAR and while the detailed triangles stay
 * within `budget`; the stand-in out to FAR; nothing beyond. Pure.
 */
export function chooseDetail(
  pieces: readonly Piece[],
  x: number,
  z: number,
  trianglesOf: Readonly<Record<FurnitureKind, number>>,
  budget: number,
  order: number[] = [],
): { detailed: number[]; simple: number[]; triangles: number } {
  const d2 = (i: number) => (pieces[i]!.x - x) ** 2 + (pieces[i]!.z - z) ** 2;
  order.length = 0;
  for (let i = 0; i < pieces.length; i++) if (d2(i) <= FAR * FAR) order.push(i);
  order.sort((a, b) => d2(a) - d2(b));
  const detailed: number[] = [];
  const simple: number[] = [];
  let triangles = 0;
  for (const i of order) {
    const cost = trianglesOf[pieces[i]!.kind];
    if (d2(i) <= NEAR * NEAR && triangles + cost <= budget) { detailed.push(i); triangles += cost; }
    else simple.push(i);
  }
  return { detailed, simple, triangles };
}

/**
 * The stand-ins: a few boxes the size of each model, measured from the GLB at 0.16 (a
 * bench is 0.28 wide and 0.16 high with its back at -z; a lamp 0.49 tall) and returned
 * in the GLB's own units, so a stand-in takes exactly the detailed model's matrix.
 * Plain light grey, like the models themselves (#e7e7e7, no texture).
 */
function standIn(kind: FurnitureKind): THREE.BufferGeometry {
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) =>
    new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const parts: THREE.BufferGeometry[] =
    kind === 'bench' ? [
      box(0.278, 0.02, 0.09, 0, 0.075, 0),
      box(0.278, 0.075, 0.014, 0, 0.125, -0.041),
      box(0.018, 0.075, 0.08, -0.12, 0.0375, 0),
      box(0.018, 0.075, 0.08, 0.12, 0.0375, 0),
    ]
    : kind === 'lamp' ? [
      new THREE.CylinderGeometry(0.012, 0.018, 0.44, 5).translate(0, 0.22, 0),
      box(0.064, 0.07, 0.064, 0, 0.455, 0),
    ]
    : kind === 'bin' ? [new THREE.CylinderGeometry(0.042, 0.038, 0.131, 6).translate(0, 0.0655, 0)]
    : [box(0.17, 0.02, 0.078, 0, 0.123, 0), box(0.02, 0.113, 0.02, 0, 0.0565, 0)];
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return merged.scale(1 / MEASURED_AT, 1 / MEASURED_AT, 1 / MEASURED_AT);
}

async function readModel(): Promise<ArrayBuffer> {
  const { Asset } = await import('expo-asset');
  const asset = Asset.fromModule(require('../../../assets/venues/cubbon-park/furniture.glb') as number);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  const { File } = await import('expo-file-system');
  return new File(uri).arrayBuffer();
}

const triangles = (g: THREE.BufferGeometry): number =>
  (g.index?.count ?? g.attributes.position?.count ?? 0) / 3;

/**
 * Everything after loading is exported separately for the Node budget test.
 */
export function makeVenueFurniture(
  gltf: { scene: THREE.Object3D },
  manifest: Manifest,
  garden: Garden,
): BuiltVenueFurniture {
  if (manifest.license !== 'CC0-1.0') throw new Error(`venue asset is not CC0: ${manifest.license}`);

  const source = new Map<string, THREE.Mesh>();
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) source.set(o.name, o as THREE.Mesh);
  });
  for (const name of manifest.runtime.meshes) {
    if (!source.has(name)) throw new Error(`venue GLB is missing ${name}`);
  }
  if (KINDS.length > manifest.runtime.maxDrawCalls) {
    throw new Error(`venue furniture uses ${KINDS.length} detailed draws; budget is ${manifest.runtime.maxDrawCalls}`);
  }

  const pieces = furniturePieces(garden);
  const group = new THREE.Group();
  group.name = 'cubbon-park-furniture';
  const dummy = new THREE.Object3D();
  const plain = new THREE.MeshLambertMaterial({ color: '#e7e7e7' });

  const trianglesOf = {} as Record<FurnitureKind, number>;
  const detailed = {} as Record<FurnitureKind, THREE.InstancedMesh>;
  const simple = {} as Record<FurnitureKind, THREE.InstancedMesh>;
  const standIns: THREE.BufferGeometry[] = [];
  for (const kind of KINDS) {
    const src = source.get(MESH_OF[kind])!;
    const n = Math.max(1, pieces.filter((p) => p.kind === kind).length);
    const material = Array.isArray(src.material) ? src.material[0]! : src.material;
    trianglesOf[kind] = triangles(src.geometry);
    const geo = standIn(kind);
    standIns.push(geo);
    for (const [into, mesh] of [
      [detailed, new THREE.InstancedMesh(src.geometry, material, n)],
      [simple, new THREE.InstancedMesh(geo, plain, n)],
    ] as const) {
      mesh.name = `venue-${kind}-${into === detailed ? 'detailed' : 'simple'}`;
      // The counts change as you walk, so three's bounding sphere -- computed once,
      // from whatever was drawn at that moment -- would be wrong; nothing is culled by
      // it. What is drawn is decided here instead.
      mesh.frustumCulled = false;
      mesh.raycast = () => {};
      mesh.count = 0;
      mesh.visible = false;
      into[kind] = mesh;
      group.add(mesh);
    }
  }

  /** Each piece's matrix, the same for the detailed model and its stand-in (SIZE). */
  const bigM = pieces.map((p) => {
    const [sx, sy, sz] = SIZE[p.kind];
    dummy.position.set(p.x, 0, p.z); dummy.rotation.set(0, p.rot, 0); dummy.scale.set(sx * p.scale, sy * p.scale, sz * p.scale);
    dummy.updateMatrix(); return dummy.matrix.clone();
  });
  const smallM = bigM;

  let at: [number, number] | null = null;
  let drawn = { meshes: 0, triangles: 0 };
  const order: number[] = [];
  const fill = (x: number, z: number) => {
    const pick = chooseDetail(pieces, x, z, trianglesOf, manifest.runtime.maxTriangles, order);
    const next = {} as Record<FurnitureKind, { d: number; s: number }>;
    for (const kind of KINDS) next[kind] = { d: 0, s: 0 };
    for (const i of pick.detailed) detailed[pieces[i]!.kind].setMatrixAt(next[pieces[i]!.kind].d++, bigM[i]!);
    for (const i of pick.simple) simple[pieces[i]!.kind].setMatrixAt(next[pieces[i]!.kind].s++, smallM[i]!);
    let meshes = 0;
    let tris = pick.triangles;
    for (const kind of KINDS) {
      for (const [mesh, count] of [[detailed[kind], next[kind].d], [simple[kind], next[kind].s]] as const) {
        mesh.count = count;
        mesh.visible = count > 0;
        mesh.instanceMatrix.needsUpdate = true;
        if (count > 0) meshes++;
      }
      tris += next[kind].s * triangles(simple[kind].geometry);
    }
    drawn = { meshes, triangles: Math.round(tris) };
  };

  const geometries = new Set<THREE.BufferGeometry>(standIns);
  const materials = new Set<THREE.Material>([plain]);
  for (const src of source.values()) {
    geometries.add(src.geometry);
    for (const m of Array.isArray(src.material) ? src.material : [src.material]) materials.add(m);
  }

  return {
    group,
    follow(x, z) {
      if (at && Math.hypot(x - at[0], z - at[1]) < RESORT) return;
      at = [x, z];
      fill(x, z);
    },
    stats: () => ({ ...drawn }),
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) {
        const std = m as THREE.MeshStandardMaterial;
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const) {
          std[key]?.dispose();
        }
        m.dispose();
      }
      group.clear();
    },
  };
}

export async function loadVenueFurniture(garden: Garden): Promise<BuiltVenueFurniture> {
  const bytes = await readModel();
  const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) =>
    new GLTFLoader().parse(bytes, '', resolve as never, reject));
  const manifest = require('../../../assets/venues/cubbon-park/manifest.json') as Manifest;
  return makeVenueFurniture(gltf, manifest, garden);
}
