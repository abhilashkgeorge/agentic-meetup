/**
 * The garden you walk in. Grown from a seed, so this is checkable without a renderer:
 * the same neighbourhood always grows the same garden, the path runs from one side to
 * the other, and nothing is placed where somebody would have to stand inside it.
 *
 * Negative controls, run by hand and recorded in the commit: drop the `clearOfPath`
 * test when placing trees -> "keeps the path clear" fails; return the raw control
 * points instead of the smoothed curve -> "the path is a walk, not a dog-leg" fails.
 */
import { describe, expect, it } from 'vitest';
import { AREA_IDS } from '@clone/shared';
import { GARDEN_RADIUS, PATH_WIDTH, gardenSpots, makeGarden, seedOfId } from '../src/features/world/garden';
import { WorldSim } from '../src/features/world/sim';

const hyp = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);

/** Distance from a point to the path, the same measure the generator uses. */
const toPath = (p: readonly number[], path: readonly (readonly number[])[]) => {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!; const b = path[i + 1]!;
    const dx = b[0]! - a[0]!; const dz = b[1]! - a[1]!;
    const len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0]! - a[0]!) * dx + (p[1]! - a[1]!) * dz) / len2));
    best = Math.min(best, Math.hypot(p[0]! - (a[0]! + t * dx), p[1]! - (a[1]! + t * dz)));
  }
  return best;
};

describe('the garden', () => {
  it('is the same garden every time, and a different one per neighbourhood', () => {
    expect(makeGarden('koramangala')).toEqual(makeGarden('koramangala'));
    const a = makeGarden('koramangala'); const b = makeGarden('whitefield');
    expect(a.path).not.toEqual(b.path);
    expect(a.trees.length).toBeGreaterThan(0);
    expect(seedOfId('koramangala')).not.toBe(seedOfId('whitefield'));
    // Every neighbourhood grows one, and none of them comes out empty.
    for (const id of AREA_IDS) {
      const g = makeGarden(id);
      expect(g.trees.length, `${id} trees`).toBeGreaterThan(15);
      expect(g.tufts.length, `${id} grass`).toBeGreaterThan(300);
      expect(g.spots.length, `${id} spots`).toBe(26);
      expect(g.props.length, `${id} props`).toBeGreaterThan(3);
    }
  });

  it('lays a path right across it, as a walk rather than a dog-leg', () => {
    const g = makeGarden('indiranagar');
    // It starts and ends outside, so it reads as going somewhere.
    expect(Math.hypot(g.path[0]![0], g.path[0]![1])).toBeGreaterThan(GARDEN_RADIUS);
    expect(Math.hypot(g.path.at(-1)![0], g.path.at(-1)![1])).toBeGreaterThan(GARDEN_RADIUS);
    // ...on opposite sides of the garden, and through the middle of it.
    expect(hyp(g.path[0]!, g.path.at(-1)!)).toBeGreaterThan(GARDEN_RADIUS * 1.5);
    expect(Math.min(...g.path.map((p) => Math.hypot(p[0], p[1])))).toBeLessThan(GARDEN_RADIUS * 0.5);
    // Smooth: no step along it is longer than a stride, and no corner is a hairpin.
    for (let i = 1; i < g.path.length; i++) expect(hyp(g.path[i]!, g.path[i - 1]!)).toBeLessThan(4);
    for (let i = 1; i + 1 < g.path.length; i++) {
      const a = g.path[i - 1]!; const b = g.path[i]!; const c = g.path[i + 1]!;
      const d1 = Math.atan2(b[0] - a[0], b[1] - a[1]);
      const d2 = Math.atan2(c[0] - b[0], c[1] - b[1]);
      let turn = Math.abs(d2 - d1) % (Math.PI * 2);
      if (turn > Math.PI) turn = Math.PI * 2 - turn;
      expect(turn, `hairpin at ${i}`).toBeLessThan(0.9);
    }
  });

  it('keeps the path clear and puts nobody inside a tree, a stone or the pond', () => {
    for (const id of ['koramangala', 'whitefield', 'jayanagar', 'hebbal', 'kengeri']) {
      const g = makeGarden(id);
      const sim = new WorldSim(1);
      sim.setMap(gardenSpots(g));
      for (const t of g.trees) expect(toPath([t.x, t.z], g.path), `${id} tree on the path`).toBeGreaterThan(PATH_WIDTH / 2);
      for (const s of g.spots) {
        expect(sim.standable(s[0], s[1]), `${id} spot ${s}`).toBe(true);
        expect(Math.hypot(s[0], s[1]), `${id} spot outside`).toBeLessThan(GARDEN_RADIUS);
      }
      expect(sim.standable(g.home[0], g.home[1]), `${id} home`).toBe(true);
    }
  });

  it('is walled in: you can push at the edge but not out of it', () => {
    const g = makeGarden('btm-layout');
    const sim = new WorldSim(2);
    sim.setMap(gardenSpots(g));
    sim.upsert([{ ref: 'you', kind: 'you', seed: 7, area: g.id }]);
    const you = sim.get('you')!;
    // Walk hard at the edge for a while; the ring of solids has to hold.
    sim.drive('you', 0.62, 0.62);
    for (let i = 0; i < 60 * 30; i++) sim.step(1 / 30);
    expect(Math.hypot(you.x, you.z), 'walked out of the world').toBeLessThan(GARDEN_RADIUS + 2.5);
  });

  it('hands the sim one area with everything in it', () => {
    const g = makeGarden('hsr-layout');
    const spots = gardenSpots(g);
    expect(Object.keys(spots.areas)).toEqual([g.id]);
    expect(spots.central).toBe(g.id);
    expect(spots.lakes).toHaveLength(1);
    expect(spots.solids!.length).toBeGreaterThan(g.trees.length + g.props.length);
    // Every solid has a height, or the walking camera cannot tell a rock from a tree.
    for (const s of spots.solids!) { expect(s.h).toBeGreaterThan(0); expect(s.r).toBeGreaterThan(0); }
  });
});
