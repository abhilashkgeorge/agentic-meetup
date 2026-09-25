/**
 * The shipped furniture library is turned into four batched venue details.
 *
 * A source GLB can be small and still render badly if every object becomes a draw
 * call. This test loads the real file and exercises the runtime batching path.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { makeGarden } from '../src/features/world/garden';
import { makeVenueFurniture } from '../src/features/world/venue-mesh';

type Ctor = { new (type: string, init?: Record<string, unknown>): Event };
(globalThis as Record<string, unknown>).ProgressEvent ??= class extends Event {
  constructor(type: string, init: Record<string, unknown> = {}) { super(type); Object.assign(this, init); }
} as unknown as Ctor;

const dir = join(import.meta.dirname, '..', 'assets', 'venues', 'cubbon-park');
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
let gltf: { scene: import('three').Object3D };

beforeAll(async () => {
  const b = readFileSync(join(dir, manifest.file));
  gltf = await new Promise((resolve, reject) =>
    new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', resolve, reject));
});

describe('the drawn venue furniture', () => {
  it('batches every repeated prop into no more than four draw calls', () => {
    const built = makeVenueFurniture(gltf, manifest, makeGarden('cubbon-park'));
    const stats = built.stats();
    expect(stats.meshes).toBe(4);
    expect(stats.triangles).toBeGreaterThan(1_000);
    expect(stats.triangles).toBeLessThanOrEqual(manifest.runtime.maxTriangles);
    for (const child of built.group.children) {
      expect((child as import('three').InstancedMesh).isInstancedMesh).toBe(true);
    }
    built.dispose();
  });
});
