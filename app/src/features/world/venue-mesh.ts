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
 * else out to FAR -- the walking camera's far plane -- is a plain grey stand-in of a
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

const SCALE = 0.16;
/**
 * How close a piece has to be for the detailed model. The haze starts at 18 units
 * (canvas.tsx), so the change from model to stand-in happens where the haze is
 * already softening both; and at this radius the park's densest stretch still fits
 * the budget, which the nearest-first order enforces anyway.
 */
export const NEAR = 24;
/** Past the walking camera's far plane (canvas.tsx: 90) nothing is drawn at all. */
export const FAR = 90;
/** How far the camera moves before the choice is made again. */
const RESORT = 1;

export type FurnitureKind = 'bench' | 'lamp' | 'bin' | 'table';
export const KINDS: readonly FurnitureKind[] = ['bench', 'lamp', 'bin', 'table'];
const MESH_OF: Record<FurnitureKind, string> = {
  bench: 'ParkFurn_Bench_A', lamp: 'ParkFurn_Lamp_A', bin: 'ParkFurn_TrashCan_C', table: 'ParkFurn_Table_I',
};

export interface Piece { kind: FurnitureKind; x: number; z: number; rot: number; scale: number }

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
 * The stand-ins: a few boxes the size of each model at SCALE, measured from the GLB
 * (a bench is 0.28 wide and 0.16 high with its back at -z; a lamp 0.49 tall). Plain
 * light grey, like the models themselves (#e7e7e7, no texture).
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
  return merged;
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

  /** Each piece's matrix, detailed (the GLB is authored ~6x too big) and stand-in. */
  const bigM = pieces.map((p) => {
    dummy.position.set(p.x, 0, p.z); dummy.rotation.set(0, p.rot, 0); dummy.scale.setScalar(SCALE * p.scale);
    dummy.updateMatrix(); return dummy.matrix.clone();
  });
  const smallM = pieces.map((p) => {
    dummy.position.set(p.x, 0, p.z); dummy.rotation.set(0, p.rot, 0); dummy.scale.setScalar(p.scale);
    dummy.updateMatrix(); return dummy.matrix.clone();
  });

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
