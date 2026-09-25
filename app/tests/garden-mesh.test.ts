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
import { buildGarden } from '../src/features/world/garden-mesh';
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
