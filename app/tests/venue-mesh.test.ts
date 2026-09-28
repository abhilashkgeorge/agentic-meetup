/**
 * The park's benches, lamps and bins: detailed near the camera, plain further out,
 * inside the budget wherever you stand.
 *
 * WHAT WAS WRONG (the founder, 2026-09-28: "fix the park furniture"). Every piece was
 * drawn with the detailed model and the whole set was checked against a budget of
 * 20,000 triangles. The park the app draws -- the surveyed one, venueGarden -- has 417
 * pieces and 257,558 triangles, so the check threw on every visit and the park had no
 * benches or lamps at all. This test used to build the OLD seeded garden instead
 * (makeGarden), which is small enough to pass, so it went on passing.
 *
 * WHAT IS PINNED HERE, on the real park and the real GLB:
 *   - every piece within FAR of the camera is drawn exactly once, detailed or plain,
 *     and nothing beyond FAR;
 *   - the detailed ones are the nearest, inside NEAR, and never over the budget --
 *     checked from every point of a 6-unit grid over the whole park;
 *   - nothing is drawn before the camera says where it is, and at most eight meshes;
 *   - the canvas tells the furniture where the walking camera is (SOURCE SHAPE: the
 *     canvas needs a GL context, which a test in node does not have).
 *
 * Negative controls, run 2026-09-28, each restored byte-identical:
 *   - chooseDetail ignoring the budget  -> "never over the budget" fails
 *   - chooseDetail without the FAR cut   -> "exactly once, nothing beyond FAR" fails
 *   - canvas without the follow call     -> "the canvas tells the furniture" fails
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CUBBON_PARK, venueGarden } from '../src/features/world/venue';
import {
  FAR, KINDS, NEAR, chooseDetail, furniturePieces, makeVenueFurniture, type FurnitureKind,
} from '../src/features/world/venue-mesh';

type Ctor = { new (type: string, init?: Record<string, unknown>): Event };
(globalThis as Record<string, unknown>).ProgressEvent ??= class extends Event {
  constructor(type: string, init: Record<string, unknown> = {}) { super(type); Object.assign(this, init); }
} as unknown as Ctor;

const dir = join(import.meta.dirname, '..', 'assets', 'venues', 'cubbon-park');
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
let gltf: { scene: import('three').Object3D };
/** The park the app draws: the surveyed Cubbon Park, not a seeded garden. */
const park = venueGarden(CUBBON_PARK);
const pieces = furniturePieces(park);
const trianglesOf = {} as Record<FurnitureKind, number>;

beforeAll(async () => {
  const b = readFileSync(join(dir, manifest.file));
  gltf = await new Promise((resolve, reject) =>
    new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', resolve, reject));
  const names: Record<FurnitureKind, string> = {
    bench: 'ParkFurn_Bench_A', lamp: 'ParkFurn_Lamp_A', bin: 'ParkFurn_TrashCan_C', table: 'ParkFurn_Table_I',
  };
  gltf.scene.traverse((o) => {
    const mesh = o as import('three').Mesh;
    for (const k of KINDS) {
      if (mesh.isMesh && mesh.name === names[k]) {
        trianglesOf[k] = (mesh.geometry.index?.count ?? mesh.geometry.attributes.position!.count) / 3;
      }
    }
  });
});

/** Camera spots over the whole park, six units apart, plus its middle. */
function spots(): [number, number][] {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pieces) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const out: [number, number][] = [[0, 0]];
  for (let x = minX; x <= maxX; x += 6) for (let z = minZ; z <= maxZ; z += 6) out.push([x, z]);
  return out;
}

describe('the park the app draws', () => {
  it('has far more furniture than one budget holds, which is why it is split', () => {
    const count = (k: FurnitureKind) => pieces.filter((p) => p.kind === k).length;
    expect(count('bench')).toBe(park.benches.length);
    expect(count('bench')).toBeGreaterThan(100);
    expect(count('lamp')).toBeGreaterThan(100);
    const all = pieces.reduce((n, p) => n + trianglesOf[p.kind], 0);
    expect(all, 'every piece detailed at once').toBeGreaterThan(manifest.runtime.maxTriangles * 5);
  });
});

describe('detailed near, plain far', () => {
  it('draws every piece within FAR exactly once, and nothing beyond FAR', () => {
    for (const [x, z] of spots()) {
      const { detailed, simple } = chooseDetail(pieces, x, z, trianglesOf, manifest.runtime.maxTriangles);
      const drawn = [...detailed, ...simple].sort((a, b) => a - b);
      const within = pieces.map((p, i) => [p, i] as const)
        .filter(([p]) => Math.hypot(p.x - x, p.z - z) <= FAR).map(([, i]) => i);
      expect(drawn, `at ${x.toFixed(0)},${z.toFixed(0)}`).toEqual(within);
    }
  });

  it('gives the detailed model to the nearest pieces, inside NEAR, never over the budget', () => {
    let fullest = 0;
    for (const [x, z] of spots()) {
      const { detailed, simple, triangles } = chooseDetail(pieces, x, z, trianglesOf, manifest.runtime.maxTriangles);
      expect(triangles, `at ${x.toFixed(0)},${z.toFixed(0)}`).toBeLessThanOrEqual(manifest.runtime.maxTriangles);
      fullest = Math.max(fullest, triangles);
      const dist = (i: number) => Math.hypot(pieces[i]!.x - x, pieces[i]!.z - z);
      for (const i of detailed) expect(dist(i)).toBeLessThanOrEqual(NEAR);
      // A piece inside NEAR is plain ONLY because it did not fit: the detailed pieces
      // nearer than it, plus it, would have gone over the budget. (A cheaper lamp a
      // little further on may still fit where a bench did not.)
      for (const i of simple) {
        if (dist(i) > NEAR) continue;
        const nearer = detailed.filter((j) => dist(j) < dist(i)).reduce((n, j) => n + trianglesOf[pieces[j]!.kind], 0);
        expect(nearer + trianglesOf[pieces[i]!.kind], `plain ${pieces[i]!.kind} at ${dist(i).toFixed(1)}`)
          .toBeGreaterThan(manifest.runtime.maxTriangles);
      }
    }
    // The budget is what stops it somewhere in the park, or this test proves nothing.
    expect(fullest).toBeGreaterThan(manifest.runtime.maxTriangles * 0.8);
  });

  it('draws nothing until told where the camera is, then at most eight meshes', () => {
    const built = makeVenueFurniture(gltf, manifest, park);
    expect(built.stats()).toEqual({ meshes: 0, triangles: 0 });
    for (const [x, z] of spots()) {
      built.follow(x, z);
      const s = built.stats();
      expect(s.meshes).toBeLessThanOrEqual(8);
      expect(s.triangles).toBeLessThan(manifest.runtime.maxTriangles + 25_000);
    }
    for (const child of built.group.children) {
      expect((child as import('three').InstancedMesh).isInstancedMesh).toBe(true);
    }
    built.dispose();
  });

  it('the canvas tells the furniture where the walking camera is', () => {
    const code = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'canvas.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(code).toContain('furniture.current?.follow(eye[0], eye[2]);');
  });
});
