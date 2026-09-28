/**
 * What the garden actually puts in the scene.
 *
 * `garden.test.ts` is pure and stays that way; this one imports three, because the
 * bugs it guards are about MESHES rather than about geometry. Both of them shipped and
 * both were found by looking at a phone:
 *
 *   - a fountain drawn at radius zero, which collapses its basin and leaves a column
 *     with a bowl on top: a grey mushroom three metres in front of the camera.
 *   - grass built as one mesh for the whole park, which at Cubbon Park's size is
 *     24,000 blades drawn whether or not any of them is within sight.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - drop the `radius > 0` guard -> "draws no fountain where there is none" fails.
 *   - build the grass as one mesh again -> "cuts the grass into patches" fails.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VIEW, WALK_FOV } from '../src/features/world/camera';
import { buildGarden } from '../src/features/world/garden-mesh';
import { Viewport } from '../src/features/world/visible';
import { makeGarden } from '../src/features/world/garden';
import { makeCubbon } from '../src/features/world/cubbon';

const colors = { night: false, accent: '#6c5ce7' };
const named = (g: ReturnType<typeof buildGarden>) => g.group.children.map((c) => c.name);

describe('the garden mesh', () => {
  it('draws no fountain where there is no fountain', () => {
    const g = makeGarden('fountain-check');
    const dry = buildGarden({ ...g, fountain: { x: 0, z: 0, radius: 0 } }, colors);
    expect(named(dry)).not.toContain('fountain');
    expect(named(dry)).not.toContain('fountain-water');
    dry.dispose();

    const wet = buildGarden(g, colors);
    expect(named(wet), 'a garden that has one should still draw it').toContain('fountain');
    wet.dispose();
  });

  it('cuts the grass into patches, so a big park can switch most of it off', () => {
    const built = buildGarden(makeCubbon(), colors);
    const cells = built.group.children.filter((c) => c.name === 'grass');
    // One mesh for the whole park is what this replaces. A grid of them is what makes
    // `follow` able to drop the far ones.
    expect(cells.length, 'the grass is one mesh again').toBeGreaterThan(20);
    for (const c of cells) {
      expect((c as { boundingSphere?: unknown }).boundingSphere,
        'a cell with no bounding sphere cannot be culled').toBeTruthy();
    }

    // Standing in one corner, most of the park's grass is off.
    built.follow(-60, 0, -60);
    const nearCorner = cells.filter((c) => c.visible).length;
    built.follow(0, 0, 0);
    const nearMiddle = cells.filter((c) => c.visible).length;
    expect(nearCorner).toBeLessThan(cells.length * 0.6);
    expect(nearMiddle).toBeGreaterThan(0);
    // ...and moving changes which ones, rather than switching the lot on.
    expect(nearMiddle).toBeLessThan(cells.length);
    built.dispose();
  });

  it('draws the real park: its own shape, its paths, its buildings, its statues', () => {
    const built = buildGarden(makeCubbon(), colors);
    const names = named(built);
    for (const want of ['lawn', 'path', 'water', 'buildings', 'landmarks']) {
      expect(names, `no ${want} in the park`).toContain(want);
    }
    built.dispose();
  });
});

/**
 * Only the trees you can see.
 *
 * THE BUG THIS EXISTS FOR. Every tree, hedge and flower in the park was drawn every
 * frame, behind you and past the mist included: turning to face the trees took the
 * Seeker from 407 K triangles to 788 K and from 37 fps to 15 (2026-09-28).
 *
 * WHAT IS PINNED, with a real camera on the real park: every tree the camera can see
 * this side of the mist is drawn (nobody walks into a gap where a tree should be);
 * most of the park's trees are not; and a camera that has not moved sends nothing.
 *
 * Negative controls, run 2026-09-28 and restored byte-identical:
 *   - cull() packing every square, ignoring the view -> "most of the park not at all" fails
 *   - a square's ball without its trees' reach and height -> "every canopy" fails
 */
describe('the trees in view', () => {
  const setup = (x: number, z: number, yaw: number) => {
    const camera = new THREE.PerspectiveCamera(WALK_FOV, 9 / 19.5, 0.08, VIEW + 6);
    camera.position.set(x, 0.9, z);
    camera.lookAt(x + Math.sin(yaw) * 10, 0.3, z + Math.cos(yaw) * 10);
    return { camera, view: new Viewport().update(camera) };
  };
  it('draws every canopy the camera can see, and most of the park not at all', () => {
    const park = makeCubbon();
    const built = buildGarden(park, colors);
    const canopies = built.group.children.find((c) => c.name === 'canopies') as THREE.InstancedMesh;
    const trunks = built.group.children.find((c) => c.name === 'trunks') as THREE.InstancedMesh;
    // Every canopy's own ball -- where it really is, height and all, and how far its
    // leaves reach -- read before anything is culled.
    canopies.geometry.computeBoundingSphere();
    const reach = canopies.geometry.boundingSphere!.radius;
    const m = new THREE.Matrix4();
    const every = Array.from({ length: canopies.count }, (_, i) => {
      m.fromArray(canopies.instanceMatrix.array, i * 16);
      const at = new THREE.Vector3().setFromMatrixPosition(m);
      return { key: `${at.x},${at.y},${at.z}`, ball: new THREE.Sphere(at, reach * m.getMaxScaleOnAxis()) };
    });
    const frustum = new THREE.Frustum();
    let checked = 0;
    for (let k = 0; k < 60; k++) {
      const x = -60 + ((k * 37) % 120);
      const z = -70 + ((k * 53) % 140);
      const { camera, view } = setup(x, z, k * 0.7);
      built.cull(view, x, z);
      frustum.setFromProjectionMatrix(m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const a = canopies.instanceMatrix.array;
      const drawn = new Set(Array.from({ length: canopies.count }, (_, i) => `${a[i * 16 + 12]},${a[i * 16 + 13]},${a[i * 16 + 14]}`));
      for (const c of every) {
        if (Math.hypot(c.ball.center.x - x, c.ball.center.z - z) > VIEW - 2) continue;
        if (!frustum.intersectsSphere(c.ball)) continue;
        checked++;
        expect(drawn.has(c.key), `a canopy at ${c.key} is in view and not drawn (camera ${x},${z})`).toBe(true);
      }
      expect(trunks.count, 'nearly the whole park is drawn').toBeLessThan(park.trees.length * 0.45);
    }
    expect(checked, 'the cameras saw no trees, so this checked nothing').toBeGreaterThan(1000);
    built.dispose();
  });

  it('sends nothing when the view has not changed', () => {
    const built = buildGarden(makeCubbon(), colors);
    const canopies = built.group.children.find((c) => c.name === 'canopies') as THREE.InstancedMesh;
    const { view } = setup(5, 5, 0.7);
    built.cull(view, 5, 5);
    const version = canopies.instanceMatrix.version;
    built.cull(view, 5, 5);
    expect(canopies.instanceMatrix.version).toBe(version);
    // ...and exactly the rows drawn when it has.
    const turned = setup(5, 5, 2.5);
    built.cull(turned.view, 5, 5);
    expect(canopies.instanceMatrix.version).toBe(version + 1);
    expect(canopies.instanceMatrix.updateRanges).toEqual([{ start: 0, count: canopies.count * 16 }]);
    built.dispose();
  });
});
