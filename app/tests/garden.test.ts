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
    expect(spots.lakes, 'the pond and the river').toHaveLength(2);
    expect(spots.solids!.length).toBeGreaterThan(g.trees.length + g.props.length + g.benches.length);
    // Every solid has a height, or the walking camera cannot tell a rock from a tree.
    for (const s of spots.solids!) { expect(s.h).toBeGreaterThan(0); expect(s.r).toBeGreaterThan(0); }
  });

  it('is a park: somewhere to sit, something to look at, and planting', () => {
    for (const id of AREA_IDS) {
      const g = makeGarden(id);
      expect(g.benches.length, `${id} benches`).toBeGreaterThan(3);
      expect(g.bushes.length, `${id} hedges`).toBeGreaterThan(15);
      expect(g.flowers.length, `${id} flowers`).toBeGreaterThan(120);
      expect(g.reeds.length, `${id} reeds`).toBeGreaterThan(80);
      expect(g.river.length, `${id} river`).toBeGreaterThan(20);
      expect(g.fountain.radius).toBeGreaterThan(0);
      // The fountain stands beside the path, not on it and not in the water.
      expect(toPath([g.fountain.x, g.fountain.z], g.path)).toBeGreaterThan(PATH_WIDTH / 2);
    }
  });

  it('bridges the river where the path crosses it, and only there', () => {
    // Control: return `bridges: []` from gardenSpots -- the walk test below stops at
    // the near bank, because a river with no bridge is a wall across the path.
    let bridged = 0;
    for (const id of AREA_IDS) if (makeGarden(id).bridge) bridged++;
    expect(bridged, 'the river is laid across the path, so it should nearly always ford it')
      .toBeGreaterThan(AREA_IDS.length * 0.8);

    const g = makeGarden(AREA_IDS.find((id) => makeGarden(id).bridge)!);
    const b = g.bridge!;
    const sim = new WorldSim(3);
    sim.setMap(gardenSpots(g));
    // You can stand on the bridge, and not in the river a few metres upstream of it.
    expect(sim.standable(b.x, b.z), 'on the bridge').toBe(true);
    const off = g.riverLine.find((p) => Math.hypot(p[0] - b.x, p[1] - b.z) > b.span);
    expect(sim.standable(off![0], off![1]), 'in the river away from the bridge').toBe(false);
  });

  it('walks the whole path, across the water, without getting stuck', () => {
    const g = makeGarden('indiranagar');
    const sim = new WorldSim(4);
    sim.setMap(gardenSpots(g));
    sim.upsert([{ ref: 'you', kind: 'you', seed: 7, area: g.id }]);
    const you = sim.get('you')!;
    // Start at one end of the path and walk along it, steering at each waypoint.
    [you.x, you.z] = [g.path[2]![0], g.path[2]![1]];
    let reached = 0;
    for (let k = 3; k < g.path.length; k += 3) {
      const target = g.path[k]!;
      for (let i = 0; i < 300 && Math.hypot(you.x - target[0], you.z - target[1]) > 0.5; i++) {
        const dx = target[0] - you.x; const dz = target[1] - you.z;
        const len = Math.hypot(dx, dz) || 1;
        sim.drive('you', (dx / len) * 0.62, (dz / len) * 0.62);
        sim.step(1 / 30);
      }
      if (Math.hypot(you.x - target[0], you.z - target[1]) <= 0.9) reached = k;
    }
    // Control: drop the bridge and this stops dead at the river.
    expect(reached, 'got most of the way along the path').toBeGreaterThan(g.path.length * 0.7);
  });
});
