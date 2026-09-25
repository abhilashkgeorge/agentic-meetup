/**
 * The authored detail in Cubbon Park.
 *
 * Garden terrain remains procedural and cheap. Furniture comes from a bundled CC0
 * GLB, but the GLB is a LIBRARY, not a scene: four selected source meshes become four
 * InstancedMeshes no matter how many benches and lamps the venue contains.
 *
 * Reached only through canvas.tsx and therefore listed in LAZY_ONLY beside the other
 * files that import three/native modules.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Garden } from './garden';

interface Manifest {
  license: string;
  source: string;
  runtime: { meshes: string[]; maxDrawCalls: number; maxTriangles: number };
}

export interface BuiltVenueFurniture {
  group: THREE.Group;
  stats(): { meshes: number; triangles: number };
  dispose(): void;
}

const SCALE = 0.16;

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

  const group = new THREE.Group();
  group.name = 'cubbon-park-furniture';
  const dummy = new THREE.Object3D();
  const made: THREE.InstancedMesh[] = [];
  const add = (
    sourceName: string,
    placements: readonly { x: number; z: number; rot: number; scale?: number }[],
    name: string,
  ) => {
    if (!placements.length) return;
    const src = source.get(sourceName)!;
    const material = Array.isArray(src.material) ? src.material[0]! : src.material;
    const mesh = new THREE.InstancedMesh(src.geometry, material, placements.length);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    placements.forEach((p, i) => {
      const s = SCALE * (p.scale ?? 1);
      dummy.position.set(p.x, 0, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    made.push(mesh);
  };

  add('ParkFurn_Bench_A', garden.benches, 'venue-benches');
  add(
    'ParkFurn_Lamp_A',
    garden.props.filter((p) => p.kind === 'lantern'),
    'venue-lamps',
  );
  add(
    'ParkFurn_TrashCan_C',
    garden.benches.filter((_, i) => i % 3 === 0).map((b) => ({
      x: b.x + Math.cos(b.rot) * 0.35,
      z: b.z - Math.sin(b.rot) * 0.35,
      rot: b.rot,
      scale: 0.9,
    })),
    'venue-bins',
  );
  const pathAt = (t: number) => garden.path[Math.min(garden.path.length - 1, Math.floor(t * garden.path.length))]!;
  add(
    'ParkFurn_Table_I',
    [0.28, 0.68].map((t, i) => {
      const p = pathAt(t);
      return { x: p[0] + (i ? -1.2 : 1.2), z: p[1] + (i ? 0.8 : -0.8), rot: i * 1.7 };
    }),
    'venue-tables',
  );

  const stats = {
    meshes: made.length,
    triangles: Math.round(made.reduce((n, m) => n + triangles(m.geometry) * m.count, 0)),
  };
  if (stats.meshes > manifest.runtime.maxDrawCalls) {
    throw new Error(`venue furniture uses ${stats.meshes} draws; budget is ${manifest.runtime.maxDrawCalls}`);
  }
  if (stats.triangles > manifest.runtime.maxTriangles) {
    throw new Error(`venue furniture uses ${stats.triangles} triangles; budget is ${manifest.runtime.maxTriangles}`);
  }

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  for (const src of source.values()) {
    geometries.add(src.geometry);
    for (const m of Array.isArray(src.material) ? src.material : [src.material]) materials.add(m);
  }

  return {
    group,
    stats: () => ({ ...stats }),
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
